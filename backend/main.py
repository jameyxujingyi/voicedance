import asyncio
import os
import tempfile
import traceback
from pathlib import Path
from typing import List, Tuple

from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from beat_detection import detect_8beat_timestamps

app = FastAPI(title="Dance Practice Backend")

# 与前端视频库上传上限一致（单文件）
MAX_UPLOAD_BYTES = 50 * 1024 * 1024


@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    """确保未捕获异常返回 JSON；不要把 HTTPException 改成 500。"""
    if isinstance(exc, StarletteHTTPException):
        detail = exc.detail
        if not isinstance(detail, str):
            detail = str(detail)
        return JSONResponse(status_code=exc.status_code, content={"detail": detail})
    err_msg = str(exc).strip() or "服务器内部错误"
    traceback.print_exc()
    return JSONResponse(status_code=500, content={"detail": err_msg})

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _safe_suffix(filename: str | None) -> str:
    if not filename or "." not in filename:
        return ".mp4"
    return "." + filename.rsplit(".", 1)[-1].strip().lower() or "mp4"


@app.post("/analyze-video")
async def analyze_video(file: UploadFile = File(...)):
    """接收上传的视频文件，返回按八拍切分的时间戳列表。"""
    suffix = _safe_suffix(file.filename)
    contents = await file.read()
    if len(contents) > MAX_UPLOAD_BYTES:
        raise StarletteHTTPException(
            status_code=413,
            detail=f"文件过大，请上传 {MAX_UPLOAD_BYTES // (1024 * 1024)}MB 以下的视频。",
        )

    fd, tmp_path = tempfile.mkstemp(suffix=suffix, prefix="dance_upload_")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(contents)
    except Exception:
        try:
            Path(tmp_path).unlink(missing_ok=True)
        except OSError:
            pass
        raise

    try:
        # 在单独线程跑分析（librosa/ffmpeg），避免长时间阻塞事件循环
        timestamps: List[Tuple[float, float]] = await asyncio.to_thread(
            detect_8beat_timestamps, tmp_path, True
        )
        data = [
            {"index": idx + 1, "start": float(start), "end": float(end)}
            for idx, (start, end) in enumerate(timestamps)
        ]
        return {"segments": data}
    except Exception as e:
        err_msg = str(e).strip() or "未知错误"
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"detail": err_msg})
    finally:
        try:
            Path(tmp_path).unlink(missing_ok=True)
        except Exception:
            pass


@app.get("/health")
async def health():
    return JSONResponse({"status": "ok"})


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)

