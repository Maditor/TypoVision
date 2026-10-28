@echo off
for /f "tokens=5" %%a in ('netstat -aon ^| find ":3000" ^| find "LISTENING"') do (
    taskkill /F /PID %%a
    exit /b
)
echo No process listening on port 3000 found.