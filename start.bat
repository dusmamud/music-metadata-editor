@echo off
title AudioTag Pro - Audio Metadata Studio
cd /d "%~dp0"

echo ========================================================
echo         AudioTag Pro - Production Metadata Studio
echo ========================================================
echo.
echo Checking dependencies...
python -m pip install -r requirements.txt --quiet

echo.
echo Starting AudioTag Pro web server...
python app.py
pause
