@echo off
setlocal
cd /d "%~dp0"
set "ADB=%~dp0..\..\..\.tools\android-platform-tools\platform-tools\adb.exe"
if not exist "%ADB%" set "ADB=adb"
"%ADB%" reverse tcp:8743 tcp:8743 || goto fail
"%ADB%" shell am start -a android.intent.action.VIEW -d http://localhost:8743/ || goto fail
curl.exe -fsS http://localhost:8743/ >nul 2>nul && exit /b 0
python -m http.server 8743 --bind 127.0.0.1
exit /b
:fail
echo Connect your Quest via USB with developer mode enabled and approve USB debugging inside the headset.
pause
