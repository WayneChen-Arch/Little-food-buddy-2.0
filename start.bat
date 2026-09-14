@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"
title 小食伴

echo.
echo  ========================================
echo   小食伴 - 本地启动
echo  ========================================
echo.

where py >nul 2>&1
if errorlevel 1 (
    where python >nul 2>&1
    if errorlevel 1 (
        echo  [错误] 未找到 Python
        echo  请从 https://www.python.org 安装后重试
        pause
        exit /b 1
    )
    set PY=python
) else (
    set PY=py
)

set PORT=8765
echo  正在启动 http://127.0.0.1:%PORT% ...
start "小食伴-Server" /MIN %PY% -m http.server %PORT% --bind 127.0.0.1
ping 127.0.0.1 -n 4 >nul
start "" "http://127.0.0.1:%PORT%/index.html"

echo.
echo  游戏已在浏览器中打开
echo  http://127.0.0.1:%PORT%/index.html
echo.
echo  请保持此窗口打开，关闭后游戏将停止
echo  若摄像头无画面，请在浏览器地址栏允许摄像头权限
echo.
pause
