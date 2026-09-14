/**
 * 摄像头访问 — 兼容桌面/笔记本多种环境
 */

const Camera = (() => {
  function ensureMediaDevices() {
    if (!navigator.mediaDevices) {
      navigator.mediaDevices = {};
    }
    if (!navigator.mediaDevices.getUserMedia) {
      const legacy =
        navigator.getUserMedia ||
        navigator.webkitGetUserMedia ||
        navigator.mozGetUserMedia ||
        navigator.msGetUserMedia;
      if (legacy) {
        navigator.mediaDevices.getUserMedia = (constraints) =>
          new Promise((resolve, reject) => {
            legacy.call(navigator, constraints, resolve, reject);
          });
      }
    }
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  ensureMediaDevices();

  function getEnvError() {
    if (location.protocol === "file:") {
      return "不能直接双击打开 HTML。请双击 start.bat 启动游戏。";
    }
    if (!window.isSecureContext) {
      return "当前地址不支持摄像头，请用 start.bat 以 http://127.0.0.1 打开。";
    }
    if (!ensureMediaDevices()) {
      return "浏览器不支持摄像头，请使用 Chrome 或 Edge 最新版。";
    }
    return null;
  }

  function canUse() {
    return !getEnvError();
  }

  function errorMessage(err) {
    const name = err && err.name;
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      return "摄像头权限被拒绝。请点击地址栏 🔒 → 摄像头 → 允许，然后点「重试摄像头」。";
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return "未检测到摄像头。请检查 Windows 设置 → 隐私 → 摄像头 是否已开启。";
    }
    if (name === "NotReadableError" || name === "TrackStartError") {
      return "摄像头被其他软件占用。请关闭 Zoom / Teams / 微信 等后重试。";
    }
    if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") {
      return "摄像头参数不兼容，已尝试兼容模式仍失败，请点「重试摄像头」。";
    }
    if (name === "SecurityError") {
      return "安全限制：请通过 start.bat 以 http://127.0.0.1 打开。";
    }
    return "摄像头启动失败：" + (err && err.message ? err.message : "未知错误");
  }

  async function attachStream(video, stream) {
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");

    await new Promise((resolve) => {
      if (video.readyState >= 1) {
        resolve();
        return;
      }
      video.onloadedmetadata = () => resolve();
      setTimeout(resolve, 3000);
    });

    try {
      await video.play();
    } catch {
      await video.play().catch(() => {});
    }

    if (video.videoWidth === 0) {
      throw new Error("摄像头已连接但未输出画面，请重试或更换浏览器");
    }
  }

  /** 多种约束依次降级；需在用户点击后尽快调用 */
  async function open(primaryVideo, mirrorVideo) {
    const envError = getEnvError();
    if (envError) throw new Error(envError);

    const attempts = [
      { video: true, audio: false },
      { video: { facingMode: "user" }, audio: false },
      {
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      },
      {
        video: {
          facingMode: "user",
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      },
    ];

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      devices
        .filter((d) => d.kind === "videoinput" && d.deviceId)
        .forEach((cam) => {
          attempts.push({
            video: { deviceId: { exact: cam.deviceId } },
            audio: false,
          });
        });
    } catch (e) {
      console.warn("enumerateDevices:", e);
    }

    let lastErr = null;
    for (const constraints of attempts) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (!stream.getVideoTracks().length) {
          stream.getTracks().forEach((t) => t.stop());
          throw new Error("未获取到视频轨道");
        }

        await attachStream(primaryVideo, stream);
        if (mirrorVideo && mirrorVideo !== primaryVideo) {
          mirrorVideo.srcObject = stream;
          mirrorVideo.muted = true;
          mirrorVideo.playsInline = true;
          await mirrorVideo.play().catch(() => {});
        }

        return stream;
      } catch (err) {
        lastErr = err;
        console.warn("[Camera] attempt failed:", err.name, err.message);
        if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
          throw err;
        }
      }
    }

    throw lastErr || new Error("所有摄像头打开方式均失败");
  }

  function stop(stream) {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
    }
  }

  return { canUse, getEnvError, errorMessage, open, stop };
})();
