@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-local.ps1"
set "result=%ERRORLEVEL%"
if not "%result%"=="0" echo Setup falhou. Consulte a mensagem acima.
pause
exit /b %result%