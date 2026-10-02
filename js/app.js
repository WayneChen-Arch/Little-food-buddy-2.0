/**

 * 小食伴 — 主应用逻辑

 * 游戏力理念：陪伴而非催促，镜像同步而非奖惩

 */



const CAT_BASE = "assets/cat_new action2";

/** 动画素材版本：替换 MP4 后递增，避免浏览器缓存旧视频 */
const CAT_ASSET_VERSION = "4";

function catVideo(name) {
  return `${CAT_BASE}/${name}?v=${CAT_ASSET_VERSION}`;
}

const FOOD_LABELS = {
  fish: "鱼",
  veg: "菜",
  rice: "饭",
  meat: "肉",
};

/** 等待类动画及出现概率（来自 Excel） */
const WAITING_CLIPS = [
  { id: "blink", src: catVideo("等待-眨眼.mp4"), weight: 0.15 },
  { id: "eyeball", src: catVideo("等待-转眼珠.mp4"), weight: 0.1 },
  {
    id: "want_veg",
    src: catVideo("等待-想吃菜.mp4"),
    weight: 0.2,
    interactive: true,
    food: "veg",
  },
  {
    id: "want_fish",
    src: catVideo("等待-想吃鱼.mp4"),
    weight: 0.2,
    interactive: true,
    food: "fish",
  },
  {
    id: "want_rice",
    src: catVideo("等待-想吃饭.mp4"),
    weight: 0.15,
    interactive: true,
    food: "rice",
  },
  {
    id: "want_meat",
    src: catVideo("等待-想吃肉.mp4"),
    weight: 0.15,
    interactive: true,
    food: "meat",
  },
  { id: "bird", src: catVideo("等待-小鸟飞过.mp4"), weight: 0.05 },
];

const FOOD_CHAINS = {
  fish: {
    prepare: catVideo("等待-准备吃鱼.mp4"),
    execute: catVideo("执行-吃鱼.mp4"),
  },
  veg: {
    prepare: catVideo("等待-开始吃菜.mp4"),
    execute: catVideo("执行-吃菜.mp4"),
  },
  rice: {
    prepare: catVideo("等待-开始吃饭.mp4"),
    execute: catVideo("执行-吃饭.mp4"),
  },
  meat: {
    prepare: catVideo("等待-开始吃肉.mp4"),
    execute: catVideo("执行-吃肉.mp4"),
  },
};

const ALL_CAT_VIDEOS = [
  ...WAITING_CLIPS.map((c) => c.src),
  ...Object.values(FOOD_CHAINS).flatMap((chain) => [chain.prepare, chain.execute]),
];



const DEFAULT_EATING_MS = 30000;



const CatState = {

  WAITING: "waiting",

  WAITING_INTERACTIVE: "waiting_interactive",

  WAITING_FOR_BITE: "waiting_for_bite",

  EATING_SEQUENCE: "eating_sequence",

};



const App = (() => {

  const welcomeScreen = document.getElementById("welcome-screen");

  const gameScreen = document.getElementById("game-screen");

  const btnStart = document.getElementById("btn-start");

  const btnRestart = document.getElementById("btn-restart");

  const btnRetryCamera = document.getElementById("btn-retry-camera");

  const btnRetryAi = document.getElementById("btn-retry-ai");

  const envWarning = document.getElementById("env-warning");

  const webcam = document.getElementById("webcam");

  const webcamMirror = document.getElementById("webcam-mirror");

  const memojiCanvas = document.getElementById("memoji-canvas");

  const debugCanvas = document.getElementById("debug-canvas");

  const statusText = document.getElementById("status-text");

  const sensitivitySlider = document.getElementById("sensitivity");

  const showDebugCheckbox = document.getElementById("show-debug");

  const bgmEnabledCheckbox = document.getElementById("bgm-enabled");

  const bgmVolumeSlider = document.getElementById("bgm-volume");

  const btnTogglePanel = document.getElementById("btn-toggle-panel");

  const panelContent = document.getElementById("panel-content");

  const mealDurationSlider = document.getElementById("meal-duration");
  const mealDurationWelcome = document.getElementById("meal-duration-welcome");
  const mealDurationLabel = document.getElementById("meal-duration-label");
  const mealDurationLabelWelcome = document.getElementById("meal-duration-label-welcome");
  const mealFinishOverlay = document.getElementById("meal-finish-overlay");
  const btnMealDone = document.getElementById("btn-meal-done");
  const btnFinishMeal = document.getElementById("btn-finish-meal");
  const summaryScreen = document.getElementById("summary-screen");
  const summaryDurationEl = document.getElementById("summary-duration");
  const summaryChildBitesEl = document.getElementById("summary-child-bites");
  const summaryCatBitesEl = document.getElementById("summary-cat-bites");
  const btnSummaryHome = document.getElementById("btn-summary-home");



  let catState = CatState.WAITING;

  let waitingTimer = null;

  let eatingUnlockTimer = null;

  let animationFrameId = null;

  let stream = null;

  let detectorReady = false;

  let gameStarted = false;

  let eatingLocked = false;

  let biteSessionId = 0;

  let biteHandledSession = -1;

  let pendingFood = null;

  let currentInteractiveFood = null;

  let mealTimeoutId = null;
  let sessionStartTs = null;
  let childBiteCount = 0;
  let catBiteCount = 0;
  let mealEnded = false;
  let sessionMealDurationMin = 30;

  let latestDetection = null;

  const WAITING_ROTATE_MS = 12000;

  function formatMealDurationLabel(minutes) {
    if (minutes <= 0) return "不限时";
    return minutes + " 分钟";
  }

  function getMealDurationMinutes() {
    const raw = parseInt(mealDurationWelcome?.value ?? mealDurationSlider?.value ?? "30", 10);
    return Math.min(60, Math.max(0, Number.isFinite(raw) ? raw : 30));
  }

  function syncMealDurationSliders(minutes) {
    const v = String(minutes);
    if (mealDurationSlider) mealDurationSlider.value = v;
    if (mealDurationWelcome) mealDurationWelcome.value = v;
    const label = formatMealDurationLabel(minutes);
    if (mealDurationLabel) mealDurationLabel.textContent = label;
    if (mealDurationLabelWelcome) mealDurationLabelWelcome.textContent = label;
  }

  function formatDuration(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    if (m <= 0) return s + " 秒";
    if (s === 0) return m + " 分钟";
    return m + " 分 " + s + " 秒";
  }

  function clearMealSessionTimer() {
    if (mealTimeoutId) {
      clearTimeout(mealTimeoutId);
      mealTimeoutId = null;
    }
  }

  function hideMealFinishOverlay() {
    mealFinishOverlay?.classList.add("hidden");
  }

  function showMealFinishOverlay() {
    mealFinishOverlay?.classList.remove("hidden");
    panelContent?.classList.add("hidden");
  }

  function startMealSession() {
    clearMealSessionTimer();
    sessionMealDurationMin = getMealDurationMinutes();
    sessionStartTs = Date.now();
    childBiteCount = 0;
    catBiteCount = 0;
    mealEnded = false;
    hideMealFinishOverlay();

    const ms = sessionMealDurationMin * 60 * 1000;
    if (ms > 0) {
      mealTimeoutId = setTimeout(onMealTimerEnd, ms);
    }
  }

  function onMealTimerEnd() {
    mealTimeoutId = null;
    if (!gameStarted || mealEnded) return;
    showMealFinishOverlay();
  }

  function finishMealAndShowSummary() {
    if (mealEnded) return;
    mealEnded = true;
    clearMealSessionTimer();
    hideMealFinishOverlay();
    const elapsed = sessionStartTs ? Date.now() - sessionStartTs : 0;
    stopCamera();
    Bgm.stop();
    gameScreen.classList.add("hidden");
    if (summaryDurationEl) summaryDurationEl.textContent = formatDuration(elapsed);
    if (summaryChildBitesEl) summaryChildBitesEl.textContent = childBiteCount + " 口";
    if (summaryCatBitesEl) summaryCatBitesEl.textContent = catBiteCount + " 口";
    summaryScreen?.classList.remove("hidden");
  }

  function resetMealSessionState() {
    clearMealSessionTimer();
    hideMealFinishOverlay();
    summaryScreen?.classList.add("hidden");
    sessionStartTs = null;
    childBiteCount = 0;
    catBiteCount = 0;
    mealEnded = false;
  }



  function foodLabel(food) {
    return FOOD_LABELS[food] || "好吃的";
  }

  function pickWeighted(clips) {

    let roll = Math.random();

    for (const clip of clips) {

      roll -= clip.weight;

      if (roll <= 0) return clip;

    }

    return clips[clips.length - 1];

  }



  function clearEatingLockTimer() {

    if (eatingUnlockTimer) {

      clearTimeout(eatingUnlockTimer);

      eatingUnlockTimer = null;

    }

  }



  function clearWaitingRotate() {

    clearTimeout(waitingTimer);

    waitingTimer = null;

  }



  function scheduleWaitingRotate() {

    clearWaitingRotate();

    waitingTimer = setTimeout(() => {

      if (catState !== CatState.WAITING || eatingLocked) return;

      playWaitingClip(pickWeighted(WAITING_CLIPS));

    }, WAITING_ROTATE_MS);

  }



  function onPassiveWaitingEnded() {

    if (catState !== CatState.WAITING || eatingLocked) return;

    playWaitingClip(pickWeighted(WAITING_CLIPS));

  }



  function onInteractiveWaitingHeld(clip) {

    if (eatingLocked || catState !== CatState.WAITING_INTERACTIVE) return;

    catState = CatState.WAITING_FOR_BITE;

    pendingFood = clip.food;

    currentInteractiveFood = null;

    biteSessionId += 1;

    biteHandledSession = -1;

    clearWaitingRotate();

    EatingDetector.resetCatBiteState();

  }



  function playWaitingClip(clip) {
    clearWaitingRotate();

    catState = clip.interactive ? CatState.WAITING_INTERACTIVE : CatState.WAITING;

    pendingFood = null;

    currentInteractiveFood = clip.interactive ? clip.food : null;

    CatPlayer.setEating(false);

    if (clip.interactive) {
      CatPlayer.play(clip.src, {
        loop: false,
        holdLastFrame: true,
        forceRestart: true,
        onEnded: () => onInteractiveWaitingHeld(clip),
      });
      return;
    }

    CatPlayer.play(clip.src, {
      loop: false,
      onEnded: onPassiveWaitingEnded,
    });
    scheduleWaitingRotate();
  }



  function enterWaiting() {

    eatingLocked = false;

    pendingFood = null;

    clearEatingLockTimer();

    playWaitingClip(pickWeighted(WAITING_CLIPS));

  }



  function finishEatingSequence() {

    if (!eatingLocked) return;

    eatingLocked = false;

    clearEatingLockTimer();

    enterWaiting();

  }



  function startFoodChain(food) {

    if (eatingLocked || !FOOD_CHAINS[food]) return;

    const chain = FOOD_CHAINS[food];

    eatingLocked = true;

    pendingFood = null;

    catState = CatState.EATING_SEQUENCE;

    clearWaitingRotate();

    clearEatingLockTimer();

    EatingDetector.resetCatBiteState();

    CatPlayer.setEating(true);

    catBiteCount += 1;

    CatPlayer.playSequence([chain.prepare, chain.execute], finishEatingSequence);

    eatingUnlockTimer = setTimeout(finishEatingSequence, DEFAULT_EATING_MS);

  }



  function updateCatFromDetection(catBite) {

    if (eatingLocked) return;

    if (catState !== CatState.WAITING_FOR_BITE || !pendingFood) return;

    if (!catBite) return;

    if (biteHandledSession === biteSessionId) return;

    biteHandledSession = biteSessionId;

    startFoodChain(pendingFood);

  }



  function stopDetectionLoop() {

    if (animationFrameId) {

      cancelAnimationFrame(animationFrameId);

      animationFrameId = null;

    }

    clearWaitingRotate();

    clearEatingLockTimer();

  }



  function stopCamera() {

    stopDetectionLoop();

    Camera.stop(stream);

    stream = null;

    webcam.srcObject = null;

    webcamMirror.srcObject = null;

  }



  async function initDetector() {

    await EatingDetector.init((msg) => {

      statusText.textContent = msg;

    });

    detectorReady = true;

    statusText.textContent = "AI 模型就绪，开始检测";

  }



  function detectionLoop() {

    if (!stream || webcam.readyState < 2) {

      animationFrameId = requestAnimationFrame(detectionLoop);

      return;

    }



    const sensitivity = parseInt(sensitivitySlider.value, 10);

    const countChild = !eatingLocked && !mealEnded;

    const triggerCat =
      countChild && catState === CatState.WAITING_FOR_BITE && !!pendingFood;

    const result = EatingDetector.detect(webcam, sensitivity, { countChild, triggerCat });

    latestDetection = result;

    if (result.childBite) {
      childBiteCount += 1;
    }

    updateCatFromDetection(result.catBite);



    if (showDebugCheckbox.checked) {

      debugCanvas.classList.remove("hidden");

      EatingDetector.drawDebug(debugCanvas, webcam, result);

      statusText.textContent = JSON.stringify(result.debug);

    } else {

      debugCanvas.classList.add("hidden");

      if (result.debug.reason === "no_face") {

        statusText.textContent = "摄像头已开启，请对准小朋友的脸";

      } else if (eatingLocked) {

        statusText.textContent = "小猫正在吃…";

      } else if (catState === CatState.WAITING_FOR_BITE) {

        statusText.textContent = `小猫想吃${foodLabel(pendingFood)}，你也吃一口吧`;

      } else if (catState === CatState.WAITING_INTERACTIVE) {

        statusText.textContent = `小猫在看${foodLabel(currentInteractiveFood)}呢…`;

      } else if (result.childBite && result.catBite) {

        statusText.textContent = "一起吃了一口！";

      } else if (result.childBite) {

        statusText.textContent = "小朋友吃了一口！";

      } else if (result.catBite) {

        statusText.textContent = "小猫开吃！";

      } else if (result.debug.comboActive) {

        statusText.textContent =

          catState === CatState.WAITING_FOR_BITE

            ? "举手+张嘴，判定中…"

            : "等小猫想吃的时候再动手吧";

      } else if (result.debug.handUp && !result.debug.mouthOpen) {

        statusText.textContent = "已举手，请张嘴";

      } else if (result.debug.mouthOpen && !result.debug.handUp) {

        statusText.textContent = "已张嘴，请举手";

      } else {

        statusText.textContent = "等待小朋友举手+张嘴";

      }

    }



    animationFrameId = requestAnimationFrame(detectionLoop);

  }



  function showGameScreen() {

    welcomeScreen.classList.add("hidden");

    gameScreen.classList.remove("hidden");

    if (memojiCanvas) {
      Memoji.start(memojiCanvas, () => ({
        result: latestDetection,
        video: webcam,
        debug: !!(showDebugCheckbox && showDebugCheckbox.checked),
      }));
    }

  }



  function showCameraError(err) {

    statusText.textContent = Camera.errorMessage(err);

    panelContent.classList.remove("hidden");

  }



  async function afterCameraOpen() {

    statusText.textContent = "摄像头已开启 " + webcam.videoWidth + "×" + webcam.videoHeight;



    if (!detectorReady) {

      try {

        await initDetector();

      } catch (err) {

        statusText.textContent = "摄像头正常，AI 模型加载失败：" + err.message;

        panelContent.classList.remove("hidden");

        startMealSession();

        enterWaiting();

        return;

      }

    }



    startMealSession();

    enterWaiting();

    detectionLoop();

  }



  function requestCamera() {

    statusText.textContent = "正在请求摄像头…";

    panelContent.classList.remove("hidden");



    const cameraPromise = Camera.open(webcam, webcamMirror);



    cameraPromise

      .then((newStream) => {

        stream = newStream;

        return afterCameraOpen();

      })

      .catch((err) => {

        console.error("Camera error:", err);

        showCameraError(err);

      });



    return cameraPromise;

  }



  function startGame() {

    if (gameStarted) return;



    const envError = Camera.getEnvError();

    if (envError) {

      envWarning.textContent = envError;

      envWarning.classList.remove("hidden");

      return;

    }



    gameStarted = true;

    summaryScreen?.classList.add("hidden");

    hideMealFinishOverlay();

    Bgm.start();

    CatPlayer.clearPreloadCache();

    CatPlayer.preloadAll(ALL_CAT_VIDEOS);

    showGameScreen();

    CatPlayer.showLoading();

    requestCamera();

  }



  function retryCamera() {

    const envError = Camera.getEnvError();

    if (envError) {

      showCameraError(new Error(envError));

      return;

    }



    stopCamera();

    gameStarted = true;

    showGameScreen();

    CatPlayer.showLoading();

    requestCamera();

  }



  function resetToWelcome() {

    if (typeof Memoji !== "undefined") Memoji.stop();

    latestDetection = null;

    stopCamera();

    Bgm.stop();

    resetMealSessionState();

    gameScreen.classList.add("hidden");

    welcomeScreen.classList.remove("hidden");

    biteHandledSession = -1;

    biteSessionId = 0;

    eatingLocked = false;

    pendingFood = null;

    currentInteractiveFood = null;

    catState = CatState.WAITING;

    gameStarted = false;

    detectorReady = false;

    statusText.textContent = "准备中…";

    CatPlayer.showLoading();

  }



  function initBoot() {

    const envError = Camera.getEnvError();

    if (envError) {

      envWarning.textContent = envError;

      envWarning.classList.remove("hidden");

    }

    syncMealDurationSliders(30);

    CatPlayer.clearPreloadCache();

    CatPlayer.preloadAll(ALL_CAT_VIDEOS);

  }



  function retryAi() {

    detectorReady = false;

    initDetector()

      .then(() => {

        if (!animationFrameId && stream) detectionLoop();

      })

      .catch((err) => {

        statusText.textContent = "AI 模型加载失败：" + err.message;

        panelContent.classList.remove("hidden");

      });

  }



  btnStart.addEventListener("click", startGame);

  btnRestart.addEventListener("click", resetToWelcome);

  btnMealDone?.addEventListener("click", (e) => {
    e.stopPropagation();
    finishMealAndShowSummary();
  });

  btnFinishMeal?.addEventListener("click", (e) => {
    e.stopPropagation();
    finishMealAndShowSummary();
  });

  btnSummaryHome?.addEventListener("click", resetToWelcome);

  function onMealDurationInput(value) {
    const minutes = Math.min(60, Math.max(0, parseInt(value, 10) || 0));
    syncMealDurationSliders(minutes);
  }

  mealDurationSlider?.addEventListener("input", (e) => {
    onMealDurationInput(e.target.value);
  });

  mealDurationWelcome?.addEventListener("input", (e) => {
    onMealDurationInput(e.target.value);
  });

  btnRetryCamera.addEventListener("click", (e) => {

    e.stopPropagation();

    retryCamera();

  });

  btnRetryAi.addEventListener("click", (e) => {

    e.stopPropagation();

    retryAi();

  });



  btnTogglePanel.addEventListener("click", (e) => {

    e.stopPropagation();

    panelContent.classList.toggle("hidden");

  });



  panelContent.addEventListener("click", (e) => e.stopPropagation());



  bgmEnabledCheckbox.addEventListener("change", () => {

    Bgm.setEnabled(bgmEnabledCheckbox.checked);

    if (bgmEnabledCheckbox.checked && gameStarted) Bgm.start();

  });



  bgmVolumeSlider.addEventListener("input", () => {

    Bgm.setVolume(parseInt(bgmVolumeSlider.value, 10) / 100);

  });



  document.addEventListener("click", (e) => {

    const panel = document.getElementById("parent-panel");

    if (!panel.contains(e.target)) {

      panelContent.classList.add("hidden");

    }

  });



  initBoot();



  return { startGame, resetToWelcome, retryCamera };

})();


