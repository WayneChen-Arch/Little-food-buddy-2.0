@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"
title 下载 AI 模型

echo.
echo  正在下载 MediaPipe AI 模型到 assets\models ...
echo  约 11 MB，请保持网络畅通
echo.

where py >nul 2>&1
if errorlevel 1 set PY=python
if not errorlevel 1 set PY=py

%PY% -c "import urllib.request,os; os.makedirs('assets/models',exist_ok=True); urls={'face_landmarker.task':'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task','hand_landmarker.task':'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'}; [print(n, urllib.request.urlretrieve(u, 'assets/models/'+n)[0]) for n,u in urls.items()]"

if errorlevel 1 (
    echo.
    echo  [失败] 若 Google 无法访问，模型已随项目打包在 assets\models 中
    pause
    exit /b 1
)

echo.
echo  下载完成！请重新运行 start.bat
echo.
pause
