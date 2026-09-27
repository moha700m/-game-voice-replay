@echo off
setlocal
cd /d %~dp0
py -3.12 -m venv .venv
call .venv\Scripts\activate
python -m pip install --upgrade pip
pip install -r requirements.txt pyinstaller
pyinstaller --noconfirm --clean --onefile --windowed --name AI-Voice-Bridge --collect-all sounddevice app.py
echo.
echo Built: dist\AI-Voice-Bridge.exe
pause
