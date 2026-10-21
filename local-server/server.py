"""Local Whisper server with an OpenAI-compatible /v1/audio/transcriptions endpoint.

Runs faster-whisper on the NVIDIA GPU (CUDA) when available, otherwise on CPU.
Usage: start.bat  (or: python server.py)   env: PORT (default 8765), WHISPER_DEVICE (cuda|cpu)
"""
import glob
import os
import site
import sys
import tempfile
import threading


def _add_cuda_dlls():
    """Make the CUDA/cuDNN DLLs from the nvidia-* pip packages loadable on Windows."""
    if os.name != "nt":
        return
    for sp in site.getsitepackages() + [site.getusersitepackages()]:
        for d in glob.glob(os.path.join(sp, "nvidia", "*", "bin")):
            os.add_dll_directory(d)
            os.environ["PATH"] = d + os.pathsep + os.environ["PATH"]


_add_cuda_dlls()

import uvicorn  # noqa: E402
from fastapi import FastAPI, File, Form, HTTPException, UploadFile  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from faster_whisper import WhisperModel  # noqa: E402

PORT = int(os.environ.get("PORT", 8765))
DEFAULT_MODEL = "large-v3"

app = FastAPI(title="Text Recorder Local Whisper")
# Only the Chrome extension may call this server from a browser.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"chrome-extension://.*",
    allow_methods=["*"],
    allow_headers=["*"],
)

_models: dict[str, WhisperModel] = {}
_device = None
_lock = threading.Lock()  # one transcription at a time on the GPU


def _detect_device() -> str:
    forced = os.environ.get("WHISPER_DEVICE")
    if forced:
        return forced
    try:
        import ctranslate2

        return "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
    except Exception:
        return "cpu"


def get_model(name: str) -> WhisperModel:
    global _device
    if name in _models:
        return _models[name]
    if _device is None:
        _device = _detect_device()
    print(f"Loading model '{name}' on {_device} (first time downloads it)...", flush=True)
    try:
        model = WhisperModel(name, device=_device, compute_type="float16" if _device == "cuda" else "int8")
    except Exception as e:
        if _device != "cuda":
            raise
        print(f"CUDA failed ({e}); falling back to CPU", flush=True)
        _device = "cpu"
        model = WhisperModel(name, device="cpu", compute_type="int8")
    _models.clear()  # keep only one model in VRAM
    _models[name] = model
    return model


@app.get("/v1/models")
def list_models():
    return {
        "object": "list",
        "device": _device or _detect_device(),
        "data": [{"id": m, "object": "model"} for m in ["large-v3", "large-v3-turbo", "medium", "small"]],
    }


@app.post("/v1/audio/transcriptions")
def transcriptions(
    file: UploadFile = File(...),
    model: str = Form(DEFAULT_MODEL),
    language: str | None = Form(None),
    response_format: str = Form("json"),
):
    # Accept OpenAI-style names too.
    model = "large-v3" if model == "whisper-1" else model.removeprefix("whisper-")
    suffix = os.path.splitext(file.filename or "")[1] or ".webm"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(file.file.read())
        path = tmp.name
    try:
        with _lock:
            whisper = get_model(model)
            segments_iter, info = whisper.transcribe(
                path,
                language=language or None,
                beam_size=5,
                vad_filter=True,  # skip silence, reduces hallucinations
            )
            segments = [
                {"id": i, "start": s.start, "end": s.end, "text": s.text.strip()}
                for i, s in enumerate(segments_iter)
            ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        os.unlink(path)

    text = " ".join(s["text"] for s in segments if s["text"])
    print(f"Transcribed {info.duration:.0f}s of audio ({info.language})", flush=True)
    if response_format == "text":
        return text
    if response_format == "verbose_json":
        return {"task": "transcribe", "language": info.language, "duration": info.duration, "text": text, "segments": segments}
    return {"text": text}


if __name__ == "__main__":
    print(f"Python {sys.version.split()[0]} | device: {_detect_device()} | http://127.0.0.1:{PORT}/v1", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=PORT)
