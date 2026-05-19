/* ===========================================================================
   why-scene.js  ·  Structural pass
   ---------------------------------------------------------------------------
   This is the wiring layer for the /why-huddle-works.html scene. It owns:

     1. The single full-viewport <canvas> sticky inside .scene.
     2. A scroll-driven `progress ∈ [0,1]` that linearly maps `scrollY`
        from the scene's top to its bottom.
     3. A requestAnimationFrame loop (only while visible) that calls a
        painter pipeline with the current state.
     4. A flat-color painter — sky → hinge → bedrock — so we can verify
        the scroll, sticky, and act-band positions before any real art.
     5. Fade-in for the floating nav past the hinge.
     6. prefers-reduced-motion + offscreen pause guards.

   This file is deliberately structured so the REAL painters (procedural sky,
   onboarding balls, climb line, stars) layer in as additional draw functions
   inside `paintScene()`. The state object is the contract:

     {
       progress,         // [0,1] linear scroll progress
       act,              // 'sky' | 'climb' | 'hinge' | 'bedrock'
       hingeT,           // [0,1] eased crossover, 0 = day, 1 = night
       peaceT,           // [0,1] sunset blend (combined scroll + idle drift)
       driftT,           // [0,1] cycling for clouds/birds at rest
       w, h,             // viewport pixels (DPR-aware draw uses ctx scale)
       dpr,              // device pixel ratio
       reduced,          // user prefers reduced motion
       time              // ms since start (paused while offscreen)
     }
   ========================================================================= */

(() => {
  'use strict';

  const $scene  = document.getElementById('scene');
  const $stage  = document.querySelector('.scene-stage');
  const $canvas = document.getElementById('sceneCanvas');
  const $nav    = document.getElementById('whyNav');
  const $hud    = document.getElementById('sceneHud');
  if (!$scene || !$canvas) return;

  const ctx = $canvas.getContext('2d');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const debug = new URLSearchParams(location.search).has('debug');
  if (debug) $hud.hidden = false;

  /* ─── Sizing ──────────────────────────────────────────────────────────
     Resize the backing store to viewport × DPR. Logical drawing uses
     CSS pixels (we scale the context by DPR once per resize). */
  let w = 0, h = 0, dpr = 1;
  function resize() {
    dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
    w = $stage.clientWidth;
    h = $stage.clientHeight;
    $canvas.width  = Math.round(w * dpr);
    $canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ─── Scroll → progress ───────────────────────────────────────────────
     progress = (scrollY - sceneTop) / (sceneHeight - viewportHeight).
     Clamped. Updated only on scroll/resize. */
  let progress = 0;
  function updateProgress() {
    const rect = $scene.getBoundingClientRect();
    const sceneTop = rect.top + window.scrollY;
    const span = $scene.offsetHeight - window.innerHeight;
    if (span <= 0) { progress = 0; return; }
    progress = Math.max(0, Math.min(1, (window.scrollY - sceneTop) / span));
  }

  /* ─── World model ─────────────────────────────────────────────────────
     The world has TWO spatial regions divided by a ridge silhouette:
       • Sky region    — above the ridge.  Always sky.   Morphs day → sunset.
       • Bedrock region — below the ridge. Always dark navy + stars.
     Scrolling moves the camera DOWN. We model this by sliding the
     ridge upward in the viewport as `progress` grows. Once the ridge
     reaches the payoff position (≈ ⅓ down) it LOCKS — further scrolling
     advances HTML copy slots through the bedrock half while the canvas
     stays composed and gently alive (sun drift, sunset evolves). */

  // Ridge BASELINE position as a fraction of viewport height.
  //   progress 0   →  1.05  (silhouette mostly off-screen below; peak peeks)
  //   progress 0.6 →  0.55  (silhouette peak at ~⅓ down — the payoff)
  //   progress >0.6 → locked at 0.55
  const RIDGE_LOCK_PROGRESS = 0.6;
  const RIDGE_BASELINE_START = 1.05;
  const RIDGE_BASELINE_LOCKED = 0.55;

  function ridgeBaselineFrac(progress) {
    const t = Math.min(1, progress / RIDGE_LOCK_PROGRESS);
    const eased = easeInOutCubic(t);
    return RIDGE_BASELINE_START
         + (RIDGE_BASELINE_LOCKED - RIDGE_BASELINE_START) * eased;
  }

  // The ridge silhouette: control points relative to the baseline.
  //   x:    fraction of canvas width
  //   peak: how far above baseline (in viewport-h units)
  // The summit is the highest point — the 4-dot logo cluster anchors there.
  const RIDGE_PROFILE = [
    { x: 0.00, peak: 0.04 },
    { x: 0.10, peak: 0.08 },
    { x: 0.22, peak: 0.13 },
    { x: 0.35, peak: 0.17 },
    { x: 0.48, peak: 0.20 },
    { x: 0.55, peak: 0.22 }, // ← summit
    { x: 0.66, peak: 0.11 },
    { x: 0.78, peak: 0.07 },
    { x: 0.90, peak: 0.05 },
    { x: 1.00, peak: 0.03 },
  ];

  function actFor(p) {
    // Coarse act labels for the HUD and slot decisions, derived from ridge
    // position rather than fixed bands.
    if (p < 0.20) return 'sky';
    if (p < RIDGE_LOCK_PROGRESS) return 'climb';
    return 'bedrock';
  }

  /* ─── Easing helpers ──────────────────────────────────────────────── */
  const easeInOutCubic = t => t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;

  // Map any [a,b] to [0,1] with clamp.
  const remap = (v, a, b) => {
    if (b === a) return 0;
    return Math.max(0, Math.min(1, (v - a) / (b - a)));
  };

  /* ─── Color helpers ───────────────────────────────────────────────── */
  // Hex (#RRGGBB) → [r,g,b]
  function hexRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  }
  const lerp = (a, b, t) => a + (b - a) * t;
  function lerpColor(c1, c2, t) {
    const a = typeof c1 === 'string' ? hexRgb(c1) : c1;
    const b = typeof c2 === 'string' ? hexRgb(c2) : c2;
    return [
      Math.round(lerp(a[0], b[0], t)),
      Math.round(lerp(a[1], b[1], t)),
      Math.round(lerp(a[2], b[2], t)),
    ];
  }
  const rgb = c => `rgb(${c[0]},${c[1]},${c[2]})`;
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

  // Palette (matches why-scene.css custom properties).
  const SKY_DAY = {
    top: hexRgb('#DCE9FF'),
    mid: hexRgb('#C9DAFA'),
    bot: hexRgb('#B4D2FF'),
  };
  // Sunset palette pulled from climb_card.dart:861-863 for fidelity.
  const SKY_SUNSET = {
    top: hexRgb('#FF9E63'), // warm orange
    mid: hexRgb('#C29DDE'), // lavender
    bot: hexRgb('#FFC9A3'), // dusty peach
  };
  // Night palette — deep navy keeping the purple family (per user).
  const BEDROCK = {
    top: hexRgb('#0F1340'),
    mid: hexRgb('#090C2A'),
    bot: hexRgb('#050816'),
  };

  /* ─── Painter ─────────────────────────────────────────────────────────
     World-space model:
       1. Paint the sky gradient across the FULL viewport (day → sunset
          based on peaceT). It doesn't matter that we paint sky behind
          the bedrock area — the bedrock polygon covers it.
       2. Build the ridge silhouette path. The polygon BELOW the ridge
          (down to the bottom of the canvas) is the bedrock region.
       3. Fill the bedrock polygon with a dark navy gradient.
       4. Clip to that polygon and paint stars + (future) deep features.
       5. Real-art hooks (sun, clouds, birds in sky; climb line over the
          mountain; onboarding balls) plug in at the marked seams. */

  function computeColors(state) {
    // peaceT: scroll-driven sunset intensity. Saturates around progress 0.77
    // (just past the payoff lock), then holds at 1.0 while bedrock copy
    // scrolls past. Time-based drift can layer on top later.
    const peaceT = easeInOutCubic(Math.min(1, state.progress / 0.77));
    const sky = {
      top: lerpColor(SKY_DAY.top, SKY_SUNSET.top, peaceT),
      mid: lerpColor(SKY_DAY.mid, SKY_SUNSET.mid, peaceT),
      bot: lerpColor(SKY_DAY.bot, SKY_SUNSET.bot, peaceT),
    };
    return { sky, peaceT };
  }

  function paintSky(state, colors) {
    // Sky gradient spans the full viewport — bedrock polygon will mask
    // out the lower portion. Stops compressed slightly so the warmest
    // band sits just above the ridge, where the sun will set.
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0.00, rgb(colors.sky.top));
    grad.addColorStop(0.60, rgb(colors.sky.mid));
    grad.addColorStop(1.00, rgb(colors.sky.bot));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  /* Ridge geometry — computed without touching the canvas path, so sky
     painters (sun, clouds) can anchor to summit BEFORE bedrock paints. */
  function computeRidgeGeometry(state) {
    const baselineY = h * ridgeBaselineFrac(state.progress);
    const pts = RIDGE_PROFILE.map(p => ({
      x: p.x * w,
      y: baselineY - p.peak * h,
    }));
    let summit = pts[0];
    for (const p of pts) if (p.y < summit.y) summit = p;
    return { baselineY, summitX: summit.x, summitY: summit.y, pts };
  }

  /* Trace the closed bedrock polygon (ridge silhouette across, down right,
     across bottom, up left) into the canvas path and fill with bedrock
     gradient. Polygon edges follow smooth quadratic curves through ridge
     control-point midpoints (same pattern as climb_card.dart:1011-1026). */
  function paintBedrock(state, geom) {
    const pts = geom.pts;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      const my = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();

    const grad = ctx.createLinearGradient(0, geom.summitY, 0, h);
    grad.addColorStop(0.00, rgb(BEDROCK.top));
    grad.addColorStop(0.55, rgb(BEDROCK.mid));
    grad.addColorStop(1.00, rgb(BEDROCK.bot));
    ctx.fillStyle = grad;
    ctx.fill();
  }

  // ── Stars (bedrock region only) ──────────────────────────────────────
  // Deterministic — fixed seed so they don't shimmer-jump on resize.
  // Positions are stored in (x, worldY) where worldY is in *viewport-h*
  // units BELOW the locked ridge baseline. So as the ridge rises, more
  // stars come into view from below.
  const STAR_COUNT = 90;
  const stars = [];
  function seedStars() {
    stars.length = 0;
    let s = 0x6F75FF;
    const rnd = () => {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = 0; i < STAR_COUNT; i++) {
      stars.push({
        x:       rnd(),               // 0..1 of width
        worldY:  rnd() * 0.9,         // 0..0.9 below ridge baseline (viewport-h units)
        r:       0.5 + rnd() * 1.3,
        tw:      rnd() * Math.PI * 2,
      });
    }
  }
  seedStars();

  function paintStars(state, ridge) {
    // Bedrock has to actually be in-frame for stars to show. As the ridge
    // approaches the payoff, stars fade in.
    const alpha = easeInOutCubic(Math.min(1, state.progress / 0.55));
    if (alpha <= 0.02) return;
    // Clip to the bedrock polygon (which is the current path set by
    // buildRidgePath + already-filled paintBedrock). We need to re-build
    // the path since fill() doesn't preserve it across draws.
    ctx.save();
    // Stars are positioned relative to the locked ridge baseline so they
    // feel anchored to the bedrock, not the viewport edge.
    for (const star of stars) {
      const px = star.x * w;
      const py = ridge.baselineY + star.worldY * h;
      if (py < ridge.baselineY || py > h) continue;
      const twinkle = state.reduced
        ? 0.85
        : 0.65 + 0.35 * Math.sin(state.time * 0.001 + star.tw);
      ctx.globalAlpha = alpha * twinkle * 0.95;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(px, py, star.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /* ─── Sky-layer art (ported from climb_card.dart) ────────────────────
     The Dart painter is sized for a small card; we preserve the same
     proportions and warm/cool sunset palette but scale all geometry by
     APP_FACTOR so it reads at full-viewport size. App reference canvas
     width ≈ 340; clamp sun radius so it stays sane on ultra-wide. */

  function appFactor() { return Math.max(0.6, w / 340); }

  // Drift cycles the cloud (L→R) and birds (R→L) over a wraparound span,
  // exactly matching climb_card.dart's `span = size.width + 60.0`.
  function driftSpan() { return w + 60 * appFactor(); }

  /* SUN
     Direct port of climb_card.dart lines 891–919.
       sunYHigh = -sunR * 0.40   → sun mostly above top edge at peace=0
       sunYLow  = summitY + sunR * 0.55  → just below summit at peace=1
       sunY     = lerp(sunYHigh, sunYLow, peace)
       sunX     = anchored to summitX (app anchors to today's column)
     The disc warms from #FFD088 → #FF8A4C with peace, and a blurred halo
     intensifies (0.15 + 0.40 * peace). The bedrock polygon paints AFTER
     the sun, so any portion of the disc that has descended below the
     ridge is naturally clipped — the sun visibly sets behind the mountain. */
  function paintSun(state, geom) {
    const peace = state.peaceT;
    const factor = appFactor();
    const sunR = Math.max(18, Math.min(14 * factor, 46));
    const sunYHigh = -sunR * 0.40;
    const sunYLow  = geom.summitY + sunR * 0.55;
    const sunY = sunYHigh + (sunYLow - sunYHigh) * peace;
    const sunX = geom.summitX;

    // Halo (blurred).
    ctx.save();
    ctx.filter = 'blur(9px)';
    ctx.fillStyle = `rgba(255, 203, 138, ${0.15 + 0.40 * peace})`;
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR + 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Disc.
    const disc = lerpColor('#FFD088', '#FF8A4C', peace);
    ctx.fillStyle = rgba(disc, 0.78 + 0.18 * peace);
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
    ctx.fill();
  }

  /* CLOUDS
     Port of climb_card.dart _drawCloud (lines 1335–1360): three overlapping
     blurred ovals. Cloud drifts left→right across `span` over the drift
     cycle. Color lerps white → peach with peace, alpha thins slightly so
     clouds become wispy at full sunset. */
  function _drawCloudShape(cx, cy, cw, color) {
    const ch = cw * 0.32;
    ctx.save();
    ctx.filter = 'blur(3px)';
    ctx.fillStyle = color;
    // Main body.
    ctx.beginPath();
    ctx.ellipse(cx, cy, cw / 2, ch / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    // Right hump.
    ctx.beginPath();
    ctx.ellipse(cx + cw * 0.22, cy - ch * 0.25, (cw * 0.65) / 2, (ch * 0.85) / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    // Left hump.
    ctx.beginPath();
    ctx.ellipse(cx - cw * 0.22, cy + ch * 0.05, (cw * 0.55) / 2, (ch * 0.70) / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  function paintClouds(state) {
    const peace = state.peaceT;
    const factor = appFactor();
    const cloudW = 38 * factor;
    const cloudColor = lerpColor('#FFFFFF', '#FFD0A8', peace);
    const alpha = 0.35 * (1 - 0.4 * peace);
    const color = rgba(cloudColor, alpha);
    const span = driftSpan();
    // Two clouds at offset drift phases so the sky never feels static.
    const t1 = state.driftT;
    const t2 = (state.driftT + 0.45) % 1.0;
    _drawCloudShape(-cloudW + t1 * (span + cloudW), h * 0.10, cloudW, color);
    _drawCloudShape(-cloudW + t2 * (span + cloudW), h * 0.05, cloudW * 0.7, color);
  }

  /* BIRDS
     Port of climb_card.dart _drawBird (lines 1314–1333): two quadratic
     arcs forming the classic "M-bird" silhouette. Two birds drift R→L
     at offset phases. Color lerps day → dusk with peace, darkening into
     silhouettes against the sunset. */
  function _drawBirdShape(cx, cy, bw, color) {
    const bh = bw * 0.45;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, bw / 7);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - bw / 2, cy);
    ctx.quadraticCurveTo(cx - bw / 4, cy - bh, cx, cy - bh * 0.25);
    ctx.quadraticCurveTo(cx + bw / 4, cy - bh, cx + bw / 2, cy);
    ctx.stroke();
    ctx.restore();
  }
  function paintBirds(state) {
    const peace = state.peaceT;
    const factor = appFactor();
    const bw1 = 7.5 * factor;
    const bw2 = 6.5 * factor;
    const y1 = h * 0.07;
    const y2 = h * 0.12;
    const base = lerpColor('#6B7FAA', '#3A2D55', peace);
    const span = driftSpan();
    const t1 = (state.driftT + 0.10) % 1.0;
    const t2 = (state.driftT + 0.55) % 1.0;
    _drawBirdShape(w + 20 - t1 * span, y1, bw1, rgba(base, 0.55));
    _drawBirdShape(w + 20 - t2 * span, y2, bw2, rgba(base, 0.40));
  }
  // Story/world layer
  function paintClimbLine(state, ridge) { /* TODO: continuous climb line over ridge into bedrock */ }
  function paintOnboardingBalls(state, ridge) { /* TODO: port why_slide_one_animation.dart */ }
  function paintSummitDots(state, ridge) { /* TODO: 4-dot logo cluster at ridge.summit */ }
  // Bedrock features
  function paintRoot(state, ridge) { /* TODO: subtle root/anchor where climb line enters bedrock */ }

  /* ─── Frame ───────────────────────────────────────────────────────── */
  let startTime = performance.now();

  function paintScene(now) {
    const time = now - startTime;
    // Cloud / bird drift cycles in ~24s. Independent of scroll.
    const driftPeriodMs = 24000;
    const driftT = reduced ? 0 : (time % driftPeriodMs) / driftPeriodMs;

    const state = {
      progress,
      act: actFor(progress),
      w, h, dpr, time, driftT, reduced,
      peaceT: 0,
    };
    const colors = computeColors(state);
    state.peaceT = colors.peaceT;

    // Ridge geometry is computed up-front so sky painters (sun) can
    // anchor to the summit before the bedrock polygon clips them.
    const geom = computeRidgeGeometry(state);

    // 1. Sky gradient covers the full viewport.
    paintSky(state, colors);
    // 2. Sky-layer art. Sun paints first so clouds/birds can fly in
    //    front of it. Sun's lower half gets clipped by the bedrock
    //    polygon later — that's how it "sets behind" the mountain.
    paintSun(state, geom);
    paintClouds(state);
    paintBirds(state);
    // 3. Bedrock polygon covers everything below the ridge with the
    //    bedrock gradient. Stars then paint on top, world-anchored.
    paintBedrock(state, geom);
    paintRoot(state, geom);
    paintStars(state, geom);
    // 4. World-spanning elements: the climb line ascends through the sky,
    //    crests at the summit-with-4-dots, continues straight down into
    //    bedrock. Painted last so it sits on top of both regions.
    paintClimbLine(state, geom);
    paintSummitDots(state, geom);
    paintOnboardingBalls(state, geom);

    if (debug) {
      $hud.textContent =
        `progress    ${progress.toFixed(3)}\n` +
        `act         ${state.act}\n` +
        `peaceT      ${state.peaceT.toFixed(2)}\n` +
        `ridge frac  ${ridgeBaselineFrac(progress).toFixed(2)}\n` +
        `summit px   ${geom.summitX.toFixed(0)}, ${geom.summitY.toFixed(0)}\n` +
        `driftT      ${driftT.toFixed(2)}\n` +
        `viewport    ${w}×${h} @${dpr}x`;
    }
  }

  /* ─── Nav ─────────────────────────────────────────────────────────────
     Always visible — the floating glass sits over both sky and bedrock so
     the user feels connected to the rest of the site from the first frame. */

  /* ─── rAF loop with visibility guard ──────────────────────────────── */
  let rafId = 0;
  let running = false;
  let onscreen = true;

  function tick(now) {
    if (!running) return;
    paintScene(now);
    if (!reduced || needsScrollRepaint) {
      needsScrollRepaint = false;
      rafId = requestAnimationFrame(tick);
    } else {
      // reduced-motion: don't auto-loop — just repaint on scroll/resize.
      rafId = 0;
    }
  }

  let needsScrollRepaint = false;
  function start() {
    if (running) return;
    running = true;
    rafId = requestAnimationFrame(tick);
  }
  function stop() {
    running = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
  }

  // Pause when the scene is fully offscreen (saves battery on long pages).
  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      onscreen = e.isIntersecting;
      if (onscreen) start(); else stop();
    }
  }, { rootMargin: '0px' });
  io.observe($stage);

  // Pause when the tab is hidden.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else if (onscreen) start();
  });

  /* ─── Event wiring ────────────────────────────────────────────────── */
  function onScroll() {
    updateProgress();
    if (reduced) {
      // Force a single repaint per scroll event in reduced-motion mode.
      needsScrollRepaint = true;
      if (!rafId) rafId = requestAnimationFrame(tick);
    }
  }
  function onResize() {
    resize();
    updateProgress();
    needsScrollRepaint = true;
    if (!rafId && onscreen) rafId = requestAnimationFrame(tick);
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize);

  /* ─── Boot ────────────────────────────────────────────────────────── */
  resize();
  updateProgress();
  updateNav();
  start();
})();
