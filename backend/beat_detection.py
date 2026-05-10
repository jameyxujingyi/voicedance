"""
八拍切分模块。

核心逻辑（与第一版一致）：
  1) librosa.beat.beat_track 跑一次，拿到真实拍点时间序列
  2) 每 8 个拍点分一组：beats[0]~beats[7]、beats[8]~beats[15]...
  3) 不做"均匀拍长估算"，直接用检测到的真实拍点位置

稳健性改进（保留）：
  - ffmpeg 提取视频音轨（带超时）
  - 拍点不足时兜底
  - 全链路异常处理
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from typing import List, Tuple

import librosa
import numpy as np


FFMPEG_TIMEOUT_SEC = 35
BEATS_PER_PHRASE = 8
# 与 beat_track 常用设定一致：固定采样率可显著缩短云端分析时间（sr=None 载入 48k 长音频会非常慢）
TARGET_SR = 22050


# ----------------------------- 音频读取 ---------------------------------------

def _which_ffmpeg() -> str | None:
    return shutil.which("ffmpeg")


def _decode_video_to_wav(video_path: str, wav_path: str) -> None:
    ffmpeg = _which_ffmpeg()
    if not ffmpeg:
        raise FileNotFoundError("ffmpeg 不在 PATH 中")
    cmd = [
        ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
        "-i", video_path,
        "-vn", "-ac", "1", "-ar", "22050", "-f", "wav", wav_path,
    ]
    subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=FFMPEG_TIMEOUT_SEC)


def _load_audio(path: str, *, is_video: bool) -> tuple[np.ndarray, int, str | None]:
    """返回 (y, sr, tmp_file_path_or_None)"""
    tmp_file: str | None = None
    try:
        if is_video:
            if not _which_ffmpeg():
                raise FileNotFoundError("服务端未安装 ffmpeg，无法解析视频音轨。")
            fd, tmp_file = tempfile.mkstemp(suffix=".wav", prefix="beat_audio_")
            os.close(fd)
            _decode_video_to_wav(path, tmp_file)
            y, sr = librosa.load(tmp_file, sr=TARGET_SR, mono=True, res_type='kaiser_fast')
        else:
            y, sr = librosa.load(path, sr=TARGET_SR, mono=True, res_type='kaiser_fast')
        return y, int(sr), tmp_file
    except Exception:
        if tmp_file and os.path.isfile(tmp_file):
            try:
                os.unlink(tmp_file)
            except OSError:
                pass
        raise


# ----------------------------- 八拍切分（第一版逻辑） -------------------------

def _fallback_phrases(duration: float) -> List[Tuple[float, float]]:
    """兜底：按约 10 秒切块。"""
    if duration <= 0:
        return [(0.0, 0.5)]
    step = 10.0
    out: List[Tuple[float, float]] = []
    cur = 0.0
    while cur < duration - 0.01:
        nxt = min(duration, cur + step)
        out.append((round(cur, 3), round(nxt, 3)))
        cur = nxt
    return out or [(0.0, round(duration, 3))]


def detect_8beat_timestamps(media_path: str, is_video: bool = False) -> List[Tuple[float, float]]:
    """
    输入媒体路径，返回 [(start_sec, end_sec), ...]

    核心：librosa.beat.beat_track → 每 8 个真实拍点分一组。
    """
    if not media_path or not os.path.isfile(media_path):
        raise FileNotFoundError(f"找不到媒体文件: {media_path}")

    tmp_file: str | None = None
    try:
        y, sr, tmp_file = _load_audio(media_path, is_video=is_video)
        duration = float(librosa.get_duration(y=y, sr=sr))

        _tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
        beat_times = librosa.frames_to_time(beat_frames, sr=sr)

        num_beats = len(beat_times)
        if num_beats < BEATS_PER_PHRASE:
            return _fallback_phrases(duration)

        phrases: List[Tuple[float, float]] = []
        for i in range(0, num_beats - (BEATS_PER_PHRASE - 1), BEATS_PER_PHRASE):
            start = float(round(float(beat_times[i]), 3))
            end = float(round(float(beat_times[i + BEATS_PER_PHRASE - 1]), 3))
            phrases.append((start, end))

        return phrases if phrases else _fallback_phrases(duration)

    except FileNotFoundError:
        raise
    except subprocess.TimeoutExpired as e:
        raise RuntimeError(f"八拍分析失败：ffmpeg 处理超时（>{FFMPEG_TIMEOUT_SEC}s）。") from e
    except Exception as e:
        detail = str(e).strip() or repr(e)
        raise RuntimeError(f"八拍分析失败：{detail}") from e
    finally:
        if tmp_file and os.path.isfile(tmp_file):
            try:
                os.unlink(tmp_file)
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
