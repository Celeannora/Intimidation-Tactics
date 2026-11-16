@echo off
setlocal
if not exist "%~dp0scripts\Start-DeckBuilder.ps1" (
  echo The launcher files are missing. Keep this file inside the Intimidation-Tactics folder.
  pause
  exit /b 1
)
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Start-DeckBuilder.ps1" -Port 5173
exit /b %errorlevel%
