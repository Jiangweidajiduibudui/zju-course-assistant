@echo off
setlocal
set "NODE_OPTIONS="
set "NODE_PATH="
cd /d "%~dp0"
"%~dp0runtime\node.exe" "%~dp0launch.mjs" %*
if errorlevel 1 (
  echo.
  echo Startup failed. Read the message above and the user guide.
  pause
)
endlocal
