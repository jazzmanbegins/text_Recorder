@echo off
REM Download transformers.js + ONNX Runtime Web into lib/ (not stored in git)
setlocal
cd /d "%~dp0"
if not exist lib mkdir lib

set TF=https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist
set ORT=https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.0-dev.20260914-8d85527a0/dist

curl -fL -o lib\transformers.min.js %TF%/transformers.min.js || goto :fail
curl -fL -o lib\ort-wasm-simd-threaded.asyncify.mjs %ORT%/ort-wasm-simd-threaded.asyncify.mjs || goto :fail
curl -fL -o lib\ort-wasm-simd-threaded.asyncify.wasm %ORT%/ort-wasm-simd-threaded.asyncify.wasm || goto :fail

echo.
echo Done. lib/ is ready.
exit /b 0

:fail
echo.
echo Download failed.
exit /b 1
