@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js не найден. Нужна версия 22 или новее: https://nodejs.org
  pause
  exit /b 1
)
set POTOK_OPEN=1
echo.
echo  Поток запускается. Браузер откроется сам.
echo  Если нет — откройте http://127.0.0.1:4317
echo  Остановка: закройте это окно или нажмите Ctrl+C
echo.
node src\index.js
if errorlevel 1 pause
