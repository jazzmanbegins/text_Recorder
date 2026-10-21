@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist .venv\Scripts\python.exe (
  echo [1/2] Creating Python virtual environment...
  python -m venv .venv || goto :error
)

if not exist .venv\installed.flag (
  echo [2/2] Installing packages - first time only, about 3 GB...
  .venv\Scripts\python.exe -m pip install --upgrade pip || goto :error
  .venv\Scripts\python.exe -m pip install -r requirements.txt || goto :error
  echo ok> .venv\installed.flag
)

echo.
echo Local Whisper server is starting. Keep this window open while transcribing.
.venv\Scripts\python.exe server.py
pause
exit /b

:error
echo.
echo Setup failed. Make sure Python 3.10+ is installed and on PATH.
pause
exit /b 1
