@echo off
REM Space Traffic Simulator AI Service Startup Script (Windows)

set PYTHON_PATH=C:\Users\karth\AppData\Local\Microsoft\WindowsApps\PythonSoftwareFoundation.Python.3.12_qbz5n2kfra8p0\python.exe

echo Starting Space Traffic Simulator AI Service...

REM Check if virtual environment exists
if not exist "venv" (
    echo Creating virtual environment...
    %PYTHON_PATH% -m venv venv
)

REM Activate virtual environment
call venv\Scripts\activate

REM Install dependencies
echo Installing dependencies...
pip install -r requirements.txt

REM Start the service
echo Starting AI service on port 8000...
%PYTHON_PATH% ai_service.py

pause