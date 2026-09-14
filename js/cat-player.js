/**
 * 双视频层播放器：预加载 + 就绪后再切换，避免动画间隙白屏
 */
const CatPlayer = (() => {
  let layerA = null;
  let layerB = null;
  let activeEl = null;
  let currentSrc = "";
  let loadingEl = null;
  const preloadCache = new Map();

  function init() {
    layerA = document.getElementById("cat-video-a");
    layerB = document.getElementById("cat-video-b");
    loadingEl = document.getElementById("cat-loading");
    if (!layerA || !layerB) return;
    activeEl = layerA;
    layerA.classList.add("cat-layer--visible");
  }

  function showLoading() {
    loadingEl?.classList.remove("hidden");
  }

  function hideLoading() {
    loadingEl?.classList.add("hidden");
  }

  function unbindEnded(video) {
    if (!video) return;
    if (video._catFinishCleanup) {
      video._catFinishCleanup();
      video._catFinishCleanup = null;
    }
    video.onended = null;
  }

  function clearPreloadCache() {
    preloadCache.clear();
  }

  function preloadOne(src) {
    if (preloadCache.get(src) === true) return Promise.resolve();
    const pending = preloadCache.get(src);
    if (pending) return pending;

    const promise = new Promise((resolve, reject) => {
      const v = document.createElement("video");
      v.muted = true;
      v.playsInline = true;
      v.preload = "auto";
      const done = () => {
        preloadCache.set(src, true);
        resolve();
      };
      v.addEventListener("canplaythrough", done, { once: true });
      v.addEventListener("error", () => reject(new Error(src)), { once: true });
      v.src = src;
      v.load();
    });
    preloadCache.set(src, promise);
    return promise;
  }

  function preloadAll(urls) {
    return Promise.all(urls.map(preloadOne)).catch(() => {});
  }

  function getInactive() {
    return activeEl === layerA ? layerB : layerA;
  }

  function show(el) {
    layerA.classList.toggle("cat-layer--visible", el === layerA);
    layerB.classList.toggle("cat-layer--visible", el === layerB);
    activeEl = el;
  }

  function waitReady(video, src) {
    return new Promise((resolve, reject) => {
      const ready = () => {
        cleanup();
        resolve();
      };
      const fail = () => {
        cleanup();
        reject(new Error("video load failed: " + src));
      };
      const cleanup = () => {
        video.removeEventListener("canplaythrough", ready);
        video.removeEventListener("error", fail);
      };

      if (video.dataset.src === src && video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
        resolve();
        return;
      }

      video.addEventListener("canplaythrough", ready, { once: true });
      video.addEventListener("error", fail, { once: true });
      video.dataset.src = src;
      video.src = src;
      video.load();
    });
  }

  function waitFirstFrame(video) {
    return new Promise((resolve) => {
      if (!video.paused && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        resolve();
        return;
      }
      video.addEventListener("playing", () => resolve(), { once: true });
    });
  }

  function bindEnded(video, { holdLastFrame, onEnded }) {
    unbindEnded(video);
    if (!onEnded) return;

    let fired = false;
    const finish = () => {
      if (fired) return;
      fired = true;
      unbindEnded(video);
      if (holdLastFrame) {
        if (video.duration && Number.isFinite(video.duration)) {
          video.currentTime = Math.max(0, video.duration - 0.04);
        }
        video.pause();
      }
      onEnded();
    };

    const onNearEnd = () => {
      if (!video.duration || !Number.isFinite(video.duration)) return;
      if (video.currentTime >= video.duration - 0.1) {
        finish();
      }
    };

    video.onended = finish;
    if (holdLastFrame) {
      video.addEventListener("timeupdate", onNearEnd);
      video._catFinishCleanup = () => {
        video.removeEventListener("timeupdate", onNearEnd);
      };
    } else {
      video._catFinishCleanup = () => {};
    }
  }

  async function play(src, { loop = false, holdLastFrame = false, onEnded = null, forceRestart = false } = {}) {
    if (!layerA || !layerB) return;

    const current = activeEl;
    const sameClip = currentSrc === src && current.dataset.src === src;

    if (sameClip && !forceRestart) {
      current.loop = loop;
      bindEnded(current, { holdLastFrame, onEnded });
      if (!loop) current.currentTime = 0;
      await current.play().catch(() => {});
      hideLoading();
      return;
    }

    const next = getInactive();
    unbindEnded(next);
    next.loop = loop;
    bindEnded(next, { holdLastFrame, onEnded });

    try {
      await preloadOne(src);
      await waitReady(next, src);
      next.currentTime = 0;
      const playPromise = next.play();
      await waitFirstFrame(next);
      await playPromise.catch(() => {});

      unbindEnded(current);
      current.pause();
      show(next);
      currentSrc = src;
      hideLoading();
    } catch (err) {
      console.warn("CatPlayer:", err);
      unbindEnded(current);
      current.loop = loop;
      bindEnded(current, { holdLastFrame, onEnded });
      current.dataset.src = src;
      current.src = src;
      current.currentTime = 0;
      await current.play().catch(() => {});
      currentSrc = src;
      hideLoading();
    }
  }

  function playAndWait(src, options = {}) {
    return new Promise((resolve) => {
      play(src, {
        ...options,
        holdLastFrame: false,
        forceRestart: true,
        onEnded: resolve,
      });
    });
  }

  async function playSequence(sources, onComplete) {
    for (const src of sources) {
      await playAndWait(src);
    }
    if (onComplete) onComplete();
  }

  function setEating(on) {
    document.querySelector(".media-frame")?.classList.toggle("eating", on);
  }

  init();

  return { preloadAll, play, playAndWait, playSequence, setEating, showLoading, hideLoading, clearPreloadCache };
})();
