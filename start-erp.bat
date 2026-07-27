@echo off
cd /d "%~dp0"
title Jai Durga ERP
echo Starting Jai Durga ERP...
echo This window must stay open while you use the app. Close it to stop the app.
echo.
start "" cmd /c "timeout /t 4 >nul && start http://localhost:3000"
call npm run dev
echo.
echo The app has stopped.
pause
