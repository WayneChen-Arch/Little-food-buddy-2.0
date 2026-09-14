/**
 * 进食行为检测 — MediaPipe Face + Hand
 * 模型/WASM 优先本地加载，避免 Google CDN 在国内不可用
 */

const EatingDetector = (() => {
  let faceLandmarker = null;
  let handLandmarker = null;
  let lastVideoTime = -1;
  let lastCountChild = null;
  let lastTriggerCat = null;
  let lastResult = { childBite: false, catBite: false, bite: false, debug: { reason: "init" } };
  let FaceLandmarker = null;
  let HandLandmarker = null;
  let FilesetResolver = null;

  const UPPER_LIP = 13;
  const LOWER_LIP = 14;
  const MOUTH_LEFT = 61;
  const MOUTH_RIGHT = 291;
  const UPPER_OUTER = 78;
  const LOWER_OUTER = 308;
  const CHIN = 152;
  const FOREHEAD = 10;
  const LEFT_CHEEK = 234;
  const RIGHT_CHEEK = 454;
  const FINGER_TIPS = [4, 8, 12, 16, 20];
  const HAND_CHECK = [0, 4, 8, 9, 12];

  let comboFrameCount = 0;
  let lastBiteTs = 0;
  let childComboFrameCount = 0;
  let childLastBiteTs = 0;
  let catComboFrameCount = 0;
  let catLastBiteTs = 0;
  const BITE_COOLDOWN_MS = 3000;
  const CHILD_BITE_COOLDOWN_MS = 2500;
  const BITE_ON_FRAMES = 1;

  function resetBiteState() {
    comboFrameCount = 0;
    lastBiteTs = 0;
    childComboFrameCount = 0;
    childLastBiteTs = 0;
    catComboFrameCount = 0;
    catLastBiteTs = 0;
    lastVideoTime = -1;
    lastCountChild = null;
    lastTriggerCat = null;
  }

  function resetCatBiteState() {
    catComboFrameCount = 0;
    catLastBiteTs = 0;
    comboFrameCount = 0;
    lastBiteTs = 0;
  }

  function evalBiteChannel(combo, now, enabled, frameCount, lastTs, cooldownMs) {
    if (!combo) return { bite: false, frameCount: 0 };
    frameCount++;
    if (frameCount >= BITE_ON_FRAMES && now - lastTs >= cooldownMs) {
      return { bite: true, frameCount: 0, lastTs: now };
    }
    return { bite: false, frameCount, lastTs };
  }

  /** 举手 + 张嘴：小朋友口数全程统计，小猫仅 triggerCat 时响应 */
  function updateBiteState(handUp, mouthOpen, now, countChild, triggerCat) {
    const combo = handUp && mouthOpen;
    let childBite = false;
    let catBite = false;

    if (countChild) {
      const r = evalBiteChannel(
        combo,
        now,
        true,
        childComboFrameCount,
        childLastBiteTs,
        CHILD_BITE_COOLDOWN_MS
      );
      childComboFrameCount = r.frameCount;
      if (r.lastTs != null) childLastBiteTs = r.lastTs;
      childBite = r.bite;
    } else {
      childComboFrameCount = 0;
    }

    if (triggerCat) {
      const r = evalBiteChannel(combo, now, true, catComboFrameCount, catLastBiteTs, BITE_COOLDOWN_MS);
      catComboFrameCount = r.frameCount;
      if (r.lastTs != null) catLastBiteTs = r.lastTs;
      catBite = r.bite;
    } else {
      catComboFrameCount = 0;
    }

    return { childBite, catBite, bite: catBite, comboActive: combo };
  }

  const WASM_ROOTS = [
    "assets/wasm",
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm",
    "https://cdn.jsdmirror.com/npm/@mediapipe/tasks-vision@0.10.14/wasm",
    "https://unpkg.com/@mediapipe/tasks-vision@0.10.14/wasm",
  ];

  const VISION_BUNDLE_URLS = [
    "assets/vendor/vision_bundle.mjs",
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs",
    "https://cdn.jsdmirror.com/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs",
    "https://unpkg.com/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs",
  ];

  const MODEL_SETS = [
    {
      face: "assets/models/face_landmarker.task",
      hand: "assets/models/hand_landmarker.task",
      label: "本地模型",
    },
    {
      face: "https://github.com/sanderdesnaijer/mediapipe-model-mirrors/releases/download/v1/face_landmarker.task",
      hand: "https://github.com/sanderdesnaijer/mediapipe-model-mirrors/releases/download/v1/hand_landmarker.task",
      label: "GitHub 镜像",
    },
    {
      face: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
      hand: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      label: "Google 官方",
    },
  ];

  async function loadVisionLib() {
    if (FaceLandmarker) return;

    let lastErr = null;
    for (const url of VISION_BUNDLE_URLS) {
      try {
        const mod = await import(url);
        FaceLandmarker = mod.FaceLandmarker;
        HandLandmarker = mod.HandLandmarker;
        FilesetResolver = mod.FilesetResolver;
        if (FaceLandmarker && HandLandmarker && FilesetResolver) return;
      } catch (err) {
        lastErr = err;
        console.warn("[MediaPipe] JS 加载失败:", url, err.message);
      }
    }
    throw new Error("MediaPipe JS 加载失败：" + (lastErr?.message || "请检查网络或重新运行 start.bat"));
  }

  async function createLandmarkers(vision, delegate, facePath, handPath) {
    const face = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: facePath,
        delegate,
      },
      runningMode: "VIDEO",
      numFaces: 1,
      minFaceDetectionConfidence: 0.3,
      minFacePresenceConfidence: 0.3,
      minTrackingConfidence: 0.3,
    });

    const hand = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: handPath,
        delegate,
      },
      runningMode: "VIDEO",
      numHands: 2,
      minHandDetectionConfidence: 0.25,
      minHandPresenceConfidence: 0.25,
      minTrackingConfidence: 0.25,
    });

    return { face, hand };
  }

  async function init(onProgress) {
    onProgress?.("正在加载 AI 引擎…");
    await loadVisionLib();

    let lastErr = null;

    for (const wasmRoot of WASM_ROOTS) {
      onProgress?.("正在加载 WASM：" + wasmRoot.replace("https://", "").slice(0, 40) + "…");
      let vision;
      try {
        vision = await FilesetResolver.forVisionTasks(wasmRoot);
      } catch (err) {
        lastErr = err;
        console.warn("[MediaPipe] WASM 失败:", wasmRoot, err.message);
        continue;
      }

      for (const models of MODEL_SETS) {
        for (const delegate of ["GPU", "CPU"]) {
          onProgress?.(`正在加载模型（${models.label} / ${delegate}）…`);
          try {
            const result = await createLandmarkers(
              vision,
              delegate,
              models.face,
              models.hand
            );
            faceLandmarker = result.face;
            handLandmarker = result.hand;
            lastVideoTime = -1;
            lastResult = { bite: false, debug: { reason: "ready", source: models.label, delegate } };
            resetBiteState();
            console.info("[MediaPipe] 就绪:", models.label, delegate);
            return true;
          } catch (err) {
            lastErr = err;
            console.warn("[MediaPipe] 模型失败:", models.label, delegate, err.message);
          }
        }
      }
    }

    throw new Error(
      "AI 模型加载失败：" +
        (lastErr?.message || "未知错误") +
        "。请确认通过 start.bat 启动，且 assets/models 文件夹完整。"
    );
  }

  function dist(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function getMouthCenter(lm) {
    return {
      x: (lm[UPPER_LIP].x + lm[LOWER_LIP].x) / 2,
      y: (lm[UPPER_LIP].y + lm[LOWER_LIP].y) / 2,
    };
  }

  function getFaceWidth(lm) {
    return dist(lm[LEFT_CHEEK], lm[RIGHT_CHEEK]);
  }

  function getMar(lm) {
    const horiz = dist(lm[MOUTH_LEFT], lm[MOUTH_RIGHT]);
    if (horiz < 1e-6) return 0;
    const vertA = dist(lm[UPPER_LIP], lm[LOWER_LIP]);
    const vertB = dist(lm[UPPER_OUTER], lm[LOWER_OUTER]);
    return (vertA + vertB) / (2 * horiz);
  }

  function isHandNearMouth(handLm, faceLm, threshold) {
    const mouth = getMouthCenter(faceLm);
    const nose = faceLm[1];
    const fw = getFaceWidth(faceLm);

    for (const idx of FINGER_TIPS.concat([9, 0])) {
      const pt = handLm[idx];
      const dMouth = dist(pt, mouth) / fw;
      const dNose = dist(pt, nose) / fw;
      if (dMouth < threshold * 1.5) return true;
      if (dNose < threshold * 1.2) return true;
    }
    return false;
  }

  function hasHandNearMouth(handResults, faceLm, handThreshold) {
    if (!handResults.landmarks?.length) return false;
    for (const handLm of handResults.landmarks) {
      if (isHandNearMouth(handLm, faceLm, handThreshold)) return true;
    }
    return false;
  }

  function getMinHandMouthDist(handResults, faceLm) {
    if (!handResults.landmarks?.length) return null;
    const mouth = getMouthCenter(faceLm);
    const fw = getFaceWidth(faceLm);
    let min = Infinity;
    for (const handLm of handResults.landmarks) {
      for (const idx of HAND_CHECK) {
        const d = dist(handLm[idx], mouth) / fw;
        if (d < min) min = d;
      }
    }
    return min === Infinity ? null : min;
  }

  function isHandRaised(handLm, faceLm, threshold) {
    const fw = getFaceWidth(faceLm);
    const faceLeft = Math.min(faceLm[LEFT_CHEEK].x, faceLm[RIGHT_CHEEK].x);
    const faceRight = Math.max(faceLm[LEFT_CHEEK].x, faceLm[RIGHT_CHEEK].x);
    const topY = faceLm[FOREHEAD].y - fw * 0.2;
    const bottomY = faceLm[CHIN].y + fw * 0.4;

    for (const idx of HAND_CHECK) {
      const pt = handLm[idx];
      const inColumn =
        pt.x >= faceLeft - fw * 0.55 && pt.x <= faceRight + fw * 0.55;
      const inBand = pt.y >= topY && pt.y <= bottomY;
      if (inColumn && inBand) return true;
    }
    return false;
  }

  function hasHandUp(handResults, faceLm, handThreshold) {
    if (!handResults.landmarks?.length) return false;
    for (const handLm of handResults.landmarks) {
      if (
        isHandNearMouth(handLm, faceLm, handThreshold) ||
        isHandRaised(handLm, faceLm, handThreshold)
      ) {
        return true;
      }
    }
    return false;
  }

  function detect(video, sensitivity = 4, options = true) {
    let countChild = true;
    let triggerCat = true;
    if (typeof options === "boolean") {
      countChild = options;
      triggerCat = options;
    } else if (options && typeof options === "object") {
      countChild = options.countChild !== false;
      triggerCat = !!options.triggerCat;
    }

    if (!faceLandmarker || !handLandmarker || video.readyState < 2) {
      return { childBite: false, catBite: false, bite: false, debug: { reason: "not_ready" } };
    }

    const now = performance.now();
    const sameFrame = video.currentTime === lastVideoTime;
    const sameMode = countChild === lastCountChild && triggerCat === lastTriggerCat;
    if (sameFrame && sameMode && !countChild && !triggerCat) {
      return lastResult;
    }
    lastVideoTime = video.currentTime;
    lastCountChild = countChild;
    lastTriggerCat = triggerCat;

    const handThreshold = 0.85 - sensitivity * 0.1;
    const marOpen = 0.32 - sensitivity * 0.035;

    let faceResults;
    let handResults;

    try {
      faceResults = faceLandmarker.detectForVideo(video, now);
      handResults = handLandmarker.detectForVideo(video, now);
    } catch (e) {
      const errResult = {
        childBite: false,
        catBite: false,
        bite: false,
        debug: { reason: "detect_error", error: e.message },
      };
      lastResult = errResult;
      return errResult;
    }

    if (!faceResults.faceLandmarks || faceResults.faceLandmarks.length === 0) {
      const noFace = {
        childBite: false,
        catBite: false,
        bite: false,
        debug: { reason: "no_face", hands: handResults.landmarks?.length ?? 0 },
      };
      lastResult = noFace;
      return noFace;
    }

    const faceLm = faceResults.faceLandmarks[0];
    const mar = getMar(faceLm);
    const mouthOpen = mar > marOpen;
    const handUp = hasHandUp(handResults, faceLm, handThreshold);
    const minHandDist = getMinHandMouthDist(handResults, faceLm);

    const biteInfo = updateBiteState(handUp, mouthOpen, now, countChild, triggerCat);

    const result = {
      childBite: biteInfo.childBite,
      catBite: biteInfo.catBite,
      bite: biteInfo.catBite,
      debug: {
        mar: mar.toFixed(3),
        mouthOpen,
        handUp,
        comboActive: biteInfo.comboActive,
        countChild,
        triggerCat,
        childBite: biteInfo.childBite,
        catBite: biteInfo.catBite,
        minHandDist: minHandDist?.toFixed(2) ?? null,
        handCount: handResults.landmarks?.length ?? 0,
        faceDetected: true,
      },
      landmarks: {
        face: faceLm,
        hands: handResults.landmarks ?? [],
      },
    };

    lastResult = result;
    return result;
  }

  function drawDebug(canvas, video, result) {
    const ctx = canvas.getContext("2d");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    if (result.landmarks?.face) {
      const lm = result.landmarks.face;
      const fw = getFaceWidth(lm);
      const mouth = getMouthCenter(lm);
      const mx = mouth.x * canvas.width;
      const my = mouth.y * canvas.height;
      const zoneR = fw * canvas.width * 0.55;

      ctx.beginPath();
      ctx.arc(mx, my, zoneR, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255, 200, 0, 0.5)";
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(mx, my, 12, 0, Math.PI * 2);
      ctx.strokeStyle =
        result.childBite || result.catBite
          ? "#00ff88"
          : result.debug.comboActive || result.debug.phase === "combo"
            ? "#ffcc00"
            : "#ff6644";
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    if (result.landmarks?.hands) {
      for (const hand of result.landmarks.hands) {
        for (const idx of HAND_CHECK) {
          const p = hand[idx];
          ctx.beginPath();
          ctx.arc(p.x * canvas.width, p.y * canvas.height, 7, 0, Math.PI * 2);
          ctx.fillStyle =
            result.childBite || result.catBite
              ? "#00ff88"
              : result.debug.comboActive
                ? "#ffcc00"
                : "#4488ff";
          ctx.fill();
        }
      }
    }

    const lines = result.childBite || result.catBite
      ? ["✓ " + (result.childBite ? "小朋友吃了一口！" : "") + (result.catBite ? " 小猫开吃！" : "")]
      : [result.debug.comboActive ? "举手+张嘴 ✓" : "等待举手+张嘴…"];
    if (result.debug.handUp) lines.push("举手 ✓");
    if (result.debug.mouthOpen) lines.push("张嘴 ✓");
    if (result.debug.minHandDist != null) lines.push("手-嘴距离: " + result.debug.minHandDist);

    ctx.fillStyle = result.childBite || result.catBite ? "#00ff88" : "#ffffff";
    ctx.font = "bold 14px sans-serif";
    lines.forEach((line, i) => ctx.fillText(line, 10, 22 + i * 18));

    ctx.restore();
  }

  return { init, detect, drawDebug, resetBiteState, resetCatBiteState };
})();
