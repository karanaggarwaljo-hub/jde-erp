@echo off
cd /d "%~dp0"
echo Checking for Node.js...
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is not installed, or not found on PATH.
  echo Install it from https://nodejs.org ^(choose the LTS version^), restart this computer if prompted, then run setup.bat again.
  pause
  exit /b 1
)
echo Node.js found.
echo.
echo Installing dependencies - this can take a few minutes the first time...
call npm install
if errorlevel 1 (
  echo.
  echo npm install failed. Scroll up to see the error above.
  pause
  exit /b 1
)

if not exist ".env.local" (
  echo.
  echo Creating .env.local from the template...
  copy ".env.example" ".env.local" >nul
  echo IMPORTANT: open .env.local in Notepad and fill in your Supabase and Gemini keys before running the app.
)

echo.
echo Creating a desktop shortcut...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0create-shortcut.ps1"

echo.
echo Setup complete. Use the "Jai Durga ERP" icon on your Desktop to start the app.
pause
