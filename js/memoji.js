/**
 * 卡通分身 — 用跟着头部和表情动的角色替换摄像头画面，避免露出小朋友的真实脸。
 * 姿态来自面部关键点，表情优先用 MediaPipe 混合形状（张嘴、微笑、眨眼、挑眉）。
 */

const Memoji = (() => {
  const FOREHEAD = 10;
  const CHIN = 152;
  const LEFT_CHEEK = 234;
  const RIGHT_CHEEK = 454;
  const NOSE = 1;
  const UPPER_LIP = 13;
  const LOWER_LIP = 14;
  const MOUTH_LEFT = 61;
  const MOUTH_RIGHT = 291;
  const LEFT_EYE_OUTER = 33;
  const LEFT_EYE_INNER = 133;
  const LEFT_EYE_TOP = 159;
  const LEFT_EYE_BOTTOM = 145;
  const RIGHT_EYE_OUTER = 263;
  const RIGHT_EYE_INNER = 362;
  const RIGHT_EYE_TOP = 386;
  const RIGHT_EYE_BOTTOM = 374;
  const LEFT_BROW = 105;
  const RIGHT_BROW = 334;

  const pose = {
    ready: false,
    x: 0,
    y: 0,
    radius: 0,
    roll: 0,
    yaw: 0,
    pitch: 0,
    mouth: 0.04,
    smile: 0.35,
    blinkL: 0,
    blinkR: 0,
    brow: 0.12,
    gazeX: 0,
    gazeY: 0,
    presence: 0,
  };

  let rafId = 0;
  let running = false;
  let lastTs = 0;
  let blinkClock = 1.2;
  let nextBlink = 2.4;
  let autoBlink = 0;
  let biteLatch = false;
  const sparkles = [];

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function dist(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function damp(current, target, dt, speed) {
    const t = 1 - Math.exp(-speed * dt);
    return current + (target - current) * t;
  }

  function blendScore(blendshapes, name) {
    const categories = blendshapes && blendshapes.categories;
    if (!categories) return null;
    for (let i = 0; i < categories.length; i++) {
      const c = categories[i];
      if (c.categoryName === name || c.displayName === name) return c.score || 0;
    }
    return null;
  }

  function resize(canvas) {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (rect.width < 2 || rect.height < 2) return null;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    return { w, h };
  }

  /** 把归一化坐标映射到 object-fit: cover 之后的画布像素（已镜像） */
  function mapCover(nx, ny, videoW, videoH, canvasW, canvasH) {
    const videoAspect = videoW / videoH;
    const canvasAspect = canvasW / canvasH;
    let scale;
    let offsetX = 0;
    let offsetY = 0;
    if (videoAspect > canvasAspect) {
      scale = canvasH / videoH;
      offsetX = (canvasW - videoW * scale) / 2;
    } else {
      scale = canvasW / videoW;
      offsetY = (canvasH - videoH * scale) / 2;
    }
    return {
      x: nx * videoW * scale + offsetX,
      y: ny * videoH * scale + offsetY,
      scale,
    };
  }

  function featuresFrom(result, video, canvasW, canvasH) {
    const lm = result && result.landmarks && result.landmarks.face;
    const videoW = video && video.videoWidth;
    const videoH = video && video.videoHeight;
    if (!lm || !videoW || !videoH) return null;

    const mirror = (p) => ({ x: 1 - p.x, y: p.y });
    const forehead = mirror(lm[FOREHEAD]);
    const chin = mirror(lm[CHIN]);
    const leftCheek = mirror(lm[LEFT_CHEEK]);
    const rightCheek = mirror(lm[RIGHT_CHEEK]);
    const nose = mirror(lm[NOSE]);
    const leftEye = {
      x: (mirror(lm[LEFT_EYE_OUTER]).x + mirror(lm[LEFT_EYE_INNER]).x) / 2,
      y: (mirror(lm[LEFT_EYE_TOP]).y + mirror(lm[LEFT_EYE_BOTTOM]).y) / 2,
    };
    const rightEye = {
      x: (mirror(lm[RIGHT_EYE_OUTER]).x + mirror(lm[RIGHT_EYE_INNER]).x) / 2,
      y: (mirror(lm[RIGHT_EYE_TOP]).y + mirror(lm[RIGHT_EYE_BOTTOM]).y) / 2,
    };

    const faceW = Math.max(dist(leftCheek, rightCheek), 0.04);
    const faceH = Math.max(dist(forehead, chin), 0.04);
    const mid = { x: (forehead.x + chin.x) / 2, y: (forehead.y + chin.y) / 2 };
    const placed = mapCover(mid.x, mid.y, videoW, videoH, canvasW, canvasH);
    const edge = mapCover(mid.x + faceW, mid.y, videoW, videoH, canvasW, canvasH);
    const faceWidthPx = Math.abs(edge.x - placed.x);
    const radius = clamp(faceWidthPx * 0.62, canvasH * 0.18, canvasH * 0.25);
    const clampCenter = (v, lo, hi) => (lo > hi ? (lo + hi) / 2 : clamp(v, lo, hi));
    const x = clampCenter(placed.x, radius * 1.05, canvasW - radius * 1.05);
    const y = clampCenter(placed.y, radius * 1.35, canvasH - radius * 2.15);

    const screenLeft = leftEye.x < rightEye.x ? leftEye : rightEye;
    const screenRight = leftEye.x < rightEye.x ? rightEye : leftEye;
    const roll = Math.atan2(screenRight.y - screenLeft.y, screenRight.x - screenLeft.x);
    const yaw = clamp((nose.x - mid.x) / faceW * 3.2, -1, 1);
    const pitch = clamp((nose.y - mid.y) / faceH * 2.4, -1, 1);

    const blends = result.blendshapes;
    let mouth;
    let smile;
    let blinkL;
    let blinkR;
    let brow;
    let gazeX = yaw * 0.35;
    let gazeY = pitch * 0.35;

    const jaw = blendScore(blends, "jawOpen");
    if (jaw != null) {
      const funnel = blendScore(blends, "mouthFunnel") || 0;
      mouth = clamp(Math.max(jaw, funnel * 0.85), 0, 1);
      const smileL = blendScore(blends, "mouthSmileLeft") || 0;
      const smileR = blendScore(blends, "mouthSmileRight") || 0;
      smile = clamp((smileL + smileR) / 2, 0, 1);
      blinkL = clamp(blendScore(blends, "eyeBlinkLeft") || 0, 0, 1);
      blinkR = clamp(blendScore(blends, "eyeBlinkRight") || 0, 0, 1);
      const inner = blendScore(blends, "browInnerUp") || 0;
      const outerL = blendScore(blends, "browOuterUpLeft") || 0;
      const outerR = blendScore(blends, "browOuterUpRight") || 0;
      brow = clamp((inner + outerL + outerR) / 3, 0, 1);
      const look = (a, b) => (blendScore(blends, a) || 0) - (blendScore(blends, b) || 0);
      const lookX =
        (look("eyeLookOutRight", "eyeLookInRight") + look("eyeLookInLeft", "eyeLookOutLeft")) / 2;
      const lookY =
        (look("eyeLookDownLeft", "eyeLookUpLeft") + look("eyeLookDownRight", "eyeLookUpRight")) / 2;
      gazeX = clamp(lookX * 0.75 + yaw * 0.45, -1, 1);
      gazeY = clamp(lookY * 0.75 + pitch * 0.35, -1, 1);
    } else {
      const upper = mirror(lm[UPPER_LIP]);
      const lower = mirror(lm[LOWER_LIP]);
      const mLeft = mirror(lm[MOUTH_LEFT]);
      const mRight = mirror(lm[MOUTH_RIGHT]);
      const mouthW = Math.max(dist(mLeft, mRight), 1e-4);
      const mar = dist(upper, lower) / mouthW;
      mouth = clamp((mar - 0.08) / 0.55, 0, 1);
      const cornerY = (mLeft.y + mRight.y) / 2;
      const lipY = (upper.y + lower.y) / 2;
      smile = clamp((lipY - cornerY) / (faceW * 0.08), 0, 1);
      const ear = (top, bottom, outer, inner) => {
        const w = dist(mirror(lm[outer]), mirror(lm[inner]));
        const h = dist(mirror(lm[top]), mirror(lm[bottom]));
        return w < 1e-4 ? 0.25 : h / w;
      };
      const leftEar = ear(LEFT_EYE_TOP, LEFT_EYE_BOTTOM, LEFT_EYE_OUTER, LEFT_EYE_INNER);
      const rightEar = ear(RIGHT_EYE_TOP, RIGHT_EYE_BOTTOM, RIGHT_EYE_OUTER, RIGHT_EYE_INNER);
      const toBlink = (v) => clamp((0.28 - v) / 0.16, 0, 1);
      blinkL = toBlink(leftEar);
      blinkR = toBlink(rightEar);
      const browLift =
        ((leftEye.y - mirror(lm[LEFT_BROW]).y) + (rightEye.y - mirror(lm[RIGHT_BROW]).y)) / 2;
      brow = clamp((browLift / faceH - 0.08) / 0.12, 0, 1);
    }

    return {
      x,
      y,
      radius,
      roll,
      yaw,
      pitch,
      mouth,
      smile,
      blinkL,
      blinkR,
      brow,
      gazeX,
      gazeY,
      presence: 1,
    };
  }

  function smoothToward(target, dt, canvasW, canvasH) {
    const idle = {
      x: canvasW * 0.5,
      y: canvasH * 0.43,
      radius: canvasH * 0.24,
      roll: 0,
      yaw: 0,
      pitch: 0,
      mouth: 0.02,
      smile: 0.42,
      blinkL: 0,
      blinkR: 0,
      brow: 0.08,
      gazeX: Math.sin(lastTs * 0.0007) * 0.55,
      gazeY: Math.sin(lastTs * 0.0005) * 0.15,
      presence: 0,
    };
    const src = target || idle;
    if (!pose.ready) {
      Object.assign(pose, src);
      pose.ready = true;
      return;
    }
    pose.x = damp(pose.x, src.x, dt, 8);
    pose.y = damp(pose.y, src.y, dt, 8);
    pose.radius = damp(pose.radius, src.radius, dt, 6);
    pose.roll = damp(pose.roll, src.roll, dt, 8);
    pose.yaw = damp(pose.yaw, src.yaw, dt, 8);
    pose.pitch = damp(pose.pitch, src.pitch, dt, 8);
    pose.mouth = damp(pose.mouth, src.mouth, dt, 16);
    pose.smile = damp(pose.smile, src.smile, dt, 8);
    pose.blinkL = damp(pose.blinkL, Math.max(src.blinkL, autoBlink), dt, 28);
    pose.blinkR = damp(pose.blinkR, Math.max(src.blinkR, autoBlink), dt, 28);
    pose.brow = damp(pose.brow, src.brow, dt, 10);
    pose.gazeX = damp(pose.gazeX, src.gazeX, dt, 10);
    pose.gazeY = damp(pose.gazeY, src.gazeY, dt, 10);
    pose.presence = damp(pose.presence, src.presence, dt, 6);
  }

  function tickBlink(dt, faceBlink) {
    autoBlink = Math.max(0, autoBlink - dt * 7);
    if (faceBlink > 0.45) {
      blinkClock = 0;
      return;
    }
    blinkClock += dt;
    if (blinkClock >= nextBlink) {
      autoBlink = 1;
      blinkClock = 0;
      nextBlink = 2.2 + Math.random() * 2.4;
    }
  }

  function spawnSparkles(x, y, radius) {
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI * 2 * i) / 8 + Math.random() * 0.4;
      sparkles.push({
        x: x + Math.cos(a) * radius * 0.85,
        y: y - radius * 0.2 + Math.sin(a) * radius * 0.45,
        vx: Math.cos(a) * radius * 0.8,
        vy: Math.sin(a) * radius * 0.6 - radius * 0.3,
        life: 1,
        color: i % 2 === 0 ? "#ff6b9d" : "#ffe066",
      });
    }
  }

  function updateSparkles(dt) {
    for (let i = sparkles.length - 1; i >= 0; i--) {
      const s = sparkles[i];
      s.life -= dt * 1.3;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (s.life <= 0) sparkles.splice(i, 1);
    }
  }

  function drawBackground(ctx, w, h) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#fff8ea");
    g.addColorStop(1, "#ffe7c4");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.globalAlpha = 0.9;
    const dots = [
      { x: w * 0.12, y: h * 0.1, r: w * 0.045, c: "#4ecdc4" },
      { x: w * 0.86, y: h * 0.16, r: w * 0.03, c: "#ff6b9d" },
      { x: w * 0.18, y: h * 0.9, r: w * 0.028, c: "#5b8def" },
      { x: w * 0.9, y: h * 0.82, r: w * 0.04, c: "#ffe066" },
    ];
    dots.forEach((d) => {
      ctx.fillStyle = d.c;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  function drawSparkles(ctx) {
    sparkles.forEach((s) => {
      ctx.save();
      ctx.globalAlpha = Math.max(0, s.life);
      ctx.translate(s.x, s.y);
      ctx.rotate(s.life * 2);
      ctx.fillStyle = s.color;
      ctx.fillRect(-4, -1.2, 8, 2.4);
      ctx.fillRect(-1.2, -4, 2.4, 8);
      ctx.restore();
    });
  }

  function drawBody(ctx) {
    ctx.fillStyle = "#ffe066";
    ctx.beginPath();
    ctx.moveTo(-78, 58);
    ctx.bezierCurveTo(-112, 96, -88, 148, -34, 150);
    ctx.lineTo(34, 150);
    ctx.bezierCurveTo(88, 148, 112, 96, 78, 58);
    ctx.quadraticCurveTo(0, 88, -78, 58);
    ctx.fill();

    ctx.fillStyle = "rgba(232, 122, 58, 0.28)";
    ctx.beginPath();
    ctx.ellipse(0, 78, 26, 14, 0, 0, Math.PI);
    ctx.fill();
  }

  function drawEar(ctx, side) {
    ctx.save();
    ctx.translate(78 * side, 8);
    const skin = ctx.createRadialGradient(-4 * side, -4, 4, 0, 0, 22);
    skin.addColorStop(0, "#ffe0cc");
    skin.addColorStop(1, "#f0b392");
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.ellipse(0, 0, 18, 22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f3b7a4";
    ctx.beginPath();
    ctx.ellipse(2 * side, 2, 9, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

function drawHairBack(ctx) {
  const hair = ctx.createLinearGradient(0, -110, 0, 70);
  hair.addColorStop(0, "#8d6244");
  hair.addColorStop(0.5, "#6d4630");
  hair.addColorStop(1, "#4a2f22");
  ctx.fillStyle = hair;
  ctx.beginPath();
  ctx.ellipse(-58, 20, 30, 62, 0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(58, 20, 30, 62, -0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, -28, 88, 74, 0, 0, Math.PI * 2);
  ctx.fill();
}

  function drawBangs(ctx, yaw) {
    ctx.save();
    ctx.translate(yaw * 6, 0);
    const hair = ctx.createLinearGradient(0, -100, 20, 10);
    hair.addColorStop(0, "#a87852");
    hair.addColorStop(0.4, "#7a5136");
    hair.addColorStop(1, "#5a3a28");
    ctx.fillStyle = hair;
    ctx.beginPath();
    ctx.moveTo(-74, -24);
    ctx.bezierCurveTo(-58, -6, -36, -34, -14, -16);
    ctx.bezierCurveTo(2, -2, 18, -36, 40, -14);
    ctx.bezierCurveTo(58, 2, 70, -20, 78, -36);
    ctx.lineTo(84, -78);
    ctx.quadraticCurveTo(0, -118, -84, -78);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.beginPath();
    ctx.ellipse(-22, -62, 22, 10, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawEye(ctx, x, blink, gazeX, gazeY) {
    const eyeOpen = clamp(1 - blink, 0.05, 1);
    ctx.save();
    ctx.translate(x, -8);
    ctx.scale(1, eyeOpen);
    ctx.fillStyle = "#fffdfb";
    ctx.beginPath();
    ctx.ellipse(0, 0, 16, 18, 0, 0, Math.PI * 2);
    ctx.fill();

    const ix = clamp(gazeX, -1, 1) * 4.5;
    const iy = clamp(gazeY, -1, 1) * 4.5;
    const iris = ctx.createRadialGradient(ix - 2, iy - 2, 1, ix, iy, 9);
    iris.addColorStop(0, "#8d6244");
    iris.addColorStop(0.55, "#5c3b28");
    iris.addColorStop(1, "#3a2418");
    ctx.fillStyle = iris;
    ctx.beginPath();
    ctx.arc(ix, iy, 8.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1c120e";
    ctx.beginPath();
    ctx.arc(ix, iy, 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(ix - 2.4, iy - 2.8, 2.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (eyeOpen < 0.22) {
      ctx.strokeStyle = "#5c4033";
      ctx.lineWidth = 2.4;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x - 15, -8);
      ctx.quadraticCurveTo(x, -4, x + 15, -8);
      ctx.stroke();
    }
  }

  function drawBrows(ctx, brow, yaw) {
    const lift = -6 - brow * 12;
    ctx.strokeStyle = "#4e3122";
    ctx.lineWidth = 4.2;
    ctx.lineCap = "round";
    [-1, 1].forEach((side) => {
      const tilt = side * (0.35 - brow * 0.25) + yaw * 0.15 * side;
      ctx.save();
      ctx.translate(side * 26, lift);
      ctx.rotate(tilt);
      ctx.beginPath();
      ctx.moveTo(-14, 2);
      ctx.quadraticCurveTo(0, -6, 14, 0);
      ctx.stroke();
      ctx.restore();
    });
  }

  function drawNose(ctx) {
    ctx.strokeStyle = "rgba(196, 122, 96, 0.85)";
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-1, 10);
    ctx.quadraticCurveTo(9, 18, 1, 24);
    ctx.stroke();
  }

  function drawMouth(ctx, mouth, smile) {
    ctx.save();
    ctx.translate(0, 34);
    const open = mouth;
    const width = 20 + smile * 6;

    if (open < 0.1) {
      const drop = 8 + smile * 16;
      ctx.fillStyle = "#e07878";
      ctx.beginPath();
      ctx.moveTo(-width, 1);
      ctx.quadraticCurveTo(0, drop, width, 1);
      ctx.quadraticCurveTo(0, drop * 0.28 + 3, -width, 1);
      ctx.fill();
      ctx.strokeStyle = "#c45b66";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-width + 4, 2);
      ctx.quadraticCurveTo(0, drop * 0.55, width - 4, 2);
      ctx.stroke();
    } else {
      const hh = 5 + open * 26;
      ctx.fillStyle = "#e07878";
      ctx.beginPath();
      ctx.ellipse(0, hh * 0.12, width + 3.5, hh + 4.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#4a2430";
      ctx.beginPath();
      ctx.ellipse(0, hh * 0.18, width - 1, hh, 0, 0, Math.PI * 2);
      ctx.fill();
      if (open > 0.22) {
        ctx.fillStyle = "#fff8f4";
        ctx.beginPath();
        ctx.ellipse(0, -hh * 0.28, width * 0.62, Math.min(6.5, hh * 0.38), 0, 0, Math.PI * 2);
        ctx.fill();
      }
      if (open > 0.3) {
        ctx.fillStyle = "#f09a9a";
        ctx.beginPath();
        ctx.ellipse(0, hh * 0.42, width * 0.48, hh * 0.36, 0, 0, Math.PI);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawBlush(ctx, smile, mouth) {
    ctx.fillStyle = `rgba(255, 122, 138, ${0.28 + smile * 0.28 + mouth * 0.12})`;
    [-1, 1].forEach((side) => {
      ctx.beginPath();
      ctx.ellipse(side * 40, 22, 12 + smile * 2, 7, 0, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawCharacter(ctx, bob) {
    const { yaw, pitch, smile, mouth, blinkL, blinkR, brow, gazeX, gazeY } = pose;
    ctx.save();
    ctx.translate(0, bob);
    ctx.rotate(pose.roll);
    const squash = 1 - Math.abs(yaw) * 0.06;
    ctx.scale(squash, 1);

    ctx.save();
    ctx.translate(0, 128);
    ctx.scale(1, 0.28);
    ctx.fillStyle = "rgba(45, 45, 45, 0.1)";
    ctx.beginPath();
    ctx.arc(0, 0, 78, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    drawBody(ctx);
    drawHairBack(ctx);
    drawEar(ctx, -1);
    drawEar(ctx, 1);

    const face = ctx.createRadialGradient(-20 + yaw * 10, -28, 16, yaw * 6, pitch * 6, 92);
    face.addColorStop(0, "#ffe7d4");
    face.addColorStop(0.62, "#ffd0b4");
    face.addColorStop(1, "#f3b18e");
    ctx.fillStyle = face;
    ctx.beginPath();
    ctx.ellipse(yaw * 3, 4 + pitch * 2, 74, 80, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(yaw * 14, pitch * 12);
    drawBlush(ctx, smile, mouth);
    drawBrows(ctx, brow, yaw);
    drawEye(ctx, -27, blinkL, gazeX, gazeY);
    drawEye(ctx, 27, blinkR, gazeX, gazeY);
    drawNose(ctx);
    drawMouth(ctx, mouth, smile);
    ctx.restore();

    drawBangs(ctx, yaw);
    ctx.restore();
  }

  function drawDebugMark(ctx, result, video, canvasW, canvasH) {
    const lm = result && result.landmarks && result.landmarks.face;
    if (!lm || !video || !video.videoWidth) return;
    const nose = mapCover(1 - lm[NOSE].x, lm[NOSE].y, video.videoWidth, video.videoHeight, canvasW, canvasH);
    ctx.strokeStyle = "rgba(255, 107, 157, 0.9)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(nose.x, nose.y, 10, 0, Math.PI * 2);
    ctx.stroke();
  }

  function renderFrame(canvas, result, video, debug, ts) {
    const size = resize(canvas);
    if (!size) return;
    const ctx = canvas.getContext("2d");
    const now = typeof ts === "number" ? ts : performance.now();
    const dt = lastTs ? clamp((now - lastTs) / 1000, 0, 0.05) : 0.016;
    lastTs = now;

    const target = featuresFrom(result, video, size.w, size.h);
    const faceBlink = target ? Math.max(target.blinkL, target.blinkR) : 0;
    tickBlink(dt, faceBlink);
    smoothToward(target, dt, size.w, size.h);

    const biting = !!(result && result.childBite);
    if (biting && !biteLatch) spawnSparkles(pose.x, pose.y, pose.radius || size.h * 0.2);
    biteLatch = biting;
    updateSparkles(dt);

    ctx.clearRect(0, 0, size.w, size.h);
    drawBackground(ctx, size.w, size.h);

    const bob = Math.sin(now * 0.0022) * (pose.presence > 0.65 ? 2.5 : 6);
    ctx.save();
    ctx.translate(pose.x, pose.y);
    const unit = (pose.radius || size.h * 0.24) / 80;
    ctx.scale(unit, unit);
    drawCharacter(ctx, bob / unit);
    ctx.restore();

    drawSparkles(ctx);
    if (debug) drawDebugMark(ctx, result, video, size.w, size.h);
  }

  function start(canvas, getFrame) {
    stop();
    running = true;
    lastTs = 0;
    const loop = (ts) => {
      if (!running) return;
      const frame = getFrame ? getFrame() : {};
      renderFrame(canvas, frame.result, frame.video, frame.debug, ts);
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    pose.ready = false;
    sparkles.length = 0;
    biteLatch = false;
  }

  return { start, stop, renderFrame };
})();
