"""
八拍切分模块（从头重写版）。

设计目标：
1) 单一对外接口：detect_8beat_timestamps(path, is_video)
2) 稳定返回可用片段：尽量避免“无结果”导致前端卡住
3) 全流程可控超时：避免 ffmpeg/解码长时间挂起
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from typing import List, Tuple

import librosa
import numpy as np


# ----------------------------- 配置常量 ---------------------------------------

TARGET_SR = 22050
BEATS_PER_PHRASE = 8
MIN_AUDIO_SEC = 0.35
MAX_PHRASE_SEC = 12.0
MIN_PHRASE_SEC = 0.25
FFMPEG_TIMEOUT_SEC = 35


@dataclass
class AudioData:
    y: np.ndarray
    sr: int
    duration: float
    tmp_file: str | None = None


# ----------------------------- 音频读取 ---------------------------------------

def _which_ffmpeg() -> str | None:
    return shutil.which("ffmpeg")


def _decode_video_to_wav(video_path: str, wav_path: str) -> None:
    ffmpeg = _which_ffmpeg()
    if not ffmpeg:
        raise FileNotFoundError("ffmpeg 不在 PATH 中")
    cmd = [
        ffmpeg,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        video_path,
        "-vn",
        "-ac",
        "1",
        "-ar",
        str(TARGET_SR),
        "-f",
        "wav",
        wav_path,
    ]
    subprocess.run(
        cmd,
        check=True,
        capture_output=True,
        text=True,
        timeout=FFMPEG_TIMEOUT_SEC,
    )


def _load_audio(path: str, *, is_video: bool) -> AudioData:
    tmp_file: str | None = None
    try:
        if is_video and not _which_ffmpeg():
            raise FileNotFoundError("服务端未安装 ffmpeg，无法解析视频音轨。")
        if is_video and _which_ffmpeg():
            fd, tmp_file = tempfile.mkstemp(suffix=".wav", prefix="beat_audio_")
            os.close(fd)
            _decode_video_to_wav(path, tmp_file)
            y, sr = librosa.load(tmp_file, sr=TARGET_SR, mono=True)
        else:
            y, sr = librosa.load(path, sr=TARGET_SR, mono=True)
        duration = float(librosa.get_duration(y=y, sr=sr))
        if not np.isfinite(duration) or duration <= 0:
            raise ValueError("无法读取到有效音频时长")
        return AudioData(y=np.asarray(y, dtype=np.float32), sr=int(sr), duration=duration, tmp_file=tmp_file)
    except Exception:
        if tmp_file and os.path.isfile(tmp_file):
            try:
                os.unlink(tmp_file)
            except OSError:
                pass
        raise


# ----------------------------- 节拍估计 ---------------------------------------

def _safe_times(frames: np.ndarray, sr: int, hop_length: int) -> np.ndarray:
    f = np.asarray(frames).reshape(-1)
    if f.size == 0:
        return np.array([], dtype=float)
    t = librosa.frames_to_time(f, sr=sr, hop_length=hop_length)
    t = np.asarray(t, dtype=float).reshape(-1)
    return t[np.isfinite(t)]


def _estimate_tempo(y: np.ndarray, sr: int) -> float:
    try:
        bpm_arr = librosa.feature.tempo(y=y, sr=sr, aggregate=np.median)
        bpm = float(np.ravel(bpm_arr)[0])
    except Exception:
        bpm = 120.0
    if not np.isfinite(bpm):
        bpm = 120.0
    return float(np.clip(bpm, 50.0, 220.0))


def _track_beats(y: np.ndarray, sr: int) -> np.ndarray:
    """多 hop beat_track + onset 兜底，返回升序秒级时刻。"""
    candidates: list[np.ndarray] = []
    for hop in (256, 384, 512, 1024):
        try:
            _, frames = librosa.beat.beat_track(y=y, sr=sr, hop_length=hop, tightness=100)
            candidates.append(_safe_times(frames, sr, hop))
        except Exception:
            pass

    try:
        on = librosa.onset.onset_detect(y=y, sr=sr, units="time")
        on = np.asarray(on, dtype=float).reshape(-1)
        candidates.append(on[np.isfinite(on)])
    except Exception:
        pass

    if not candidates:
        return np.array([], dtype=float)

    best = max(candidates, key=lambda x: x.size)
    best = np.unique(best.astype(float))
    return best[np.isfinite(best)]


def _synthetic_beats(duration: float, bpm: float) -> np.ndarray:
    beat_sec = 60.0 / bpm
    n = max(int(np.ceil(duration / beat_sec)) + 2, 16)
    grid = np.arange(0.0, n * beat_sec, beat_sec, dtype=float)
    return grid[grid <= duration + 1e-3]


# ----------------------------- 八拍分组 ---------------------------------------

def _clip_phrase(start: float, end: float, duration: float) -> tuple[float, float] | None:
    s = max(0.0, min(float(start), duration))
    e = max(0.0, min(float(end), duration))
    if e <= s:
        return None
    if (e - s) < MIN_PHRASE_SEC:
        return None
    if (e - s) > MAX_PHRASE_SEC:
        e = s + MAX_PHRASE_SEC
    return round(s, 3), round(e, 3)


def _beat_period_sec(beat_times: np.ndarray, bpm: float) -> float:
    """
    单一节拍间隔（秒/拍）：整首歌沿用，不随每个 beat 瞬时变化。
    优先用检测到的相邻拍间隔的中位数（抗异常点），否则用 BPM 推导。
    """
    bpm_period = 60.0 / float(np.clip(bpm, 50.0, 220.0))
    beats = np.asarray(beat_times, dtype=float).reshape(-1)
    beats = np.unique(beats[np.isfinite(beats)])
    if beats.size >= 3:
        d = np.diff(beats)
        d = d[(d > 5e-3) & np.isfinite(d)]
        if d.size >= 2:
            med = float(np.median(d))
            # 与中位 BPM 尺度一致则采用（避免 onset 乱点把间隔拉飞）
            if bpm_period * 0.45 <= med <= bpm_period * 2.2:
                return med
    return bpm_period


def _build_uniform_phrases(beat_times: np.ndarray, duration: float, bpm: float) -> List[Tuple[float, float]]:
    """
    均匀八拍：先估计一个拍长 period，再 phrase 长 = 8 * period，从锚点起等长窗口依次切开。

    不是「每一秒扫一次」：音频只解码一次；beat_track 跑一次得到拍点序列；
    这里只从中位数估出 period，之后整段只用这个 period 生成各段边界（与舞蹈里固定速度下八拍等长一致）。
    """
    beats = np.asarray(beat_times, dtype=float).reshape(-1)
    beats = np.unique(beats[np.isfinite(beats)])
    beats = beats[(beats >= -1e-6) & (beats <= duration + 1e-3)]
    if beats.size < 1:
        return []

    period = _beat_period_sec(beats, bpm)
    phrase_len = BEATS_PER_PHRASE * period
    if phrase_len < MIN_PHRASE_SEC or not np.isfinite(phrase_len):
        return []

    anchor = float(beats[0])
    out: List[Tuple[float, float]] = []
    k = 0
    # 防止浮点漂移与极长音频
    max_k = int(np.ceil(duration / phrase_len)) + 2
    while k < max_k:
        s = anchor + k * phrase_len
        if s >= duration - 1e-6:
            break
        e = min(duration, anchor + (k + 1) * phrase_len)
        piece = _clip_phrase(s, e, duration)
        if piece:
            out.append(piece)
        k += 1
    return out


def _fallback_phrases(duration: float) -> List[Tuple[float, float]]:
    """最终兜底：按约 4 秒切块，至少返回一段。"""
    if duration <= 0:
        return [(0.0, 0.5)]
    step = 4.0
    cur = 0.0
    out: List[Tuple[float, float]] = []
    while cur < duration - 1e-3:
        nxt = min(duration, cur + step)
        piece = _clip_phrase(cur, nxt, duration)
        if piece:
            out.append(piece)
        cur = nxt
    return out or [(0.0, round(duration, 3))]


# ----------------------------- 对外接口 ---------------------------------------

def detect_8beat_timestamps(media_path: str, is_video: bool = False) -> List[Tuple[float, float]]:
    """
    输入媒体路径，返回 [(start_sec, end_sec), ...]
    """
    if not media_path or not os.path.isfile(media_path):
        raise FileNotFoundError(f"找不到媒体文件: {media_path}")

    audio: AudioData | None = None
    try:
        audio = _load_audio(media_path, is_video=is_video)
        if audio.duration < MIN_AUDIO_SEC:
            return _fallback_phrases(audio.duration)

        bpm = _estimate_tempo(audio.y, audio.sr)
        beats = _track_beats(audio.y, audio.sr)
        if beats.size < BEATS_PER_PHRASE:
            beats = _synthetic_beats(audio.duration, bpm)

        phrases = _build_uniform_phrases(beats, audio.duration, bpm)
        if not phrases:
            phrases = _fallback_phrases(audio.duration)
        return phrases
    except FileNotFoundError:
        raise
    except subprocess.TimeoutExpired as e:
        raise RuntimeError(f"八拍分析失败：ffmpeg 处理超时（>{FFMPEG_TIMEOUT_SEC}s）。") from e
    except Exception as e:
        detail = str(e).strip() or repr(e)
        raise RuntimeError(f"八拍分析失败：{detail}") from e
    finally:
        if audio and audio.tmp_file and os.path.isfile(audio.tmp_file):
            try:
                os.unlink(audio.tmp_file)
            except OSError:
                pass


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("用法: cd backend && python beat_detection.py <媒体文件路径>")
        raise SystemExit(1)
    p = sys.argv[1]
    v = p.lower().endswith((".mp4", ".mov", ".webm", ".mkv", ".m4v"))
    segs = detect_8beat_timestamps(p, is_video=v)
    print(f"segments ({len(segs)}):")
    for s, e in segs[:30]:
        print(f"  {s:.3f} - {e:.3f}")
