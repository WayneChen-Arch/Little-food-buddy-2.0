/**
 * 背景音乐 — 需在用户点击后启动（浏览器策略）
 */

const Bgm = (() => {
  const SRC = "assets/music/music.mp3";
  const DEFAULT_VOLUME = 0.35;

  let audio = null;
  let enabled = true;

  function ensureAudio() {
    if (!audio) {
      audio = new Audio(SRC);
      audio.loop = true;
      audio.volume = DEFAULT_VOLUME;
      audio.preload = "auto";
    }
    return audio;
  }

  async function start() {
    if (!enabled) return;
    try {
      await ensureAudio().play();
    } catch (err) {
      console.warn("[BGM] 播放失败:", err.message);
    }
  }

  function stop() {
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
  }

  function setEnabled(on) {
    enabled = on;
    if (!on) stop();
  }

  function setVolume(value) {
    const v = Math.max(0, Math.min(1, value));
    ensureAudio().volume = v;
  }

  function isEnabled() {
    return enabled;
  }

  return { start, stop, setEnabled, setVolume, isEnabled };
})();
