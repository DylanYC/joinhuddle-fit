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

  /* ─── Act bands (must match CSS slot positions) ─────────────────────── */
  // Total scene is ~360svh. Acts:
  //   sky:     0.00 – 0.22   (≈ 0–80svh)
  //   climb:   0.22 – 0.55   (≈ 80–200svh)
  //   hinge:   0.55 – 0.68   (≈ 200–245svh)
  //   bedrock: 0.68 – 1.00   (≈ 245–360svh)
  const BAND = {
    skyEnd:     0.22,
    climbEnd:   0.55,
    hingeStart: 0.55,
    hingeEnd:   0.68,
  };

  function actFor(p) {
    if (p < BAND.skyEnd)     return 'sky';
    if (p < BAND.climbEnd)   return 'climb';
    if (p < BAND.hingeEnd)   return 'hinge';
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
     Structural pass: gradient sky lerped through 3 phases:
       phase 1  (progress 0.00 → hingeStart) :  day → sunset (peaceT 0→1)
       phase 2  (progress hingeStart → hingeEnd) : sunset → night (hingeT 0→1)
       phase 3  (progress hingeEnd → 1) :  pure night

     Real art layers (sun, mountain, ridge, balls, clouds, birds, stars)
     plug into the marked hooks below — they're empty in this pass. */

  function computeColors(state) {
    const { progress } = state;
    // peaceT: 0 = bright morning, 1 = full sunset (saturates by hinge start)
    const peaceT = easeInOutCubic(remap(progress, 0.0, BAND.hingeStart));
    // hingeT: 0 just before the hinge, 1 just after. Crisp transition.
    const hingeT = easeInOutCubic(remap(progress, BAND.hingeStart, BAND.hingeEnd));

    // Day → sunset blend
    const skyTop = lerpColor(SKY_DAY.top, SKY_SUNSET.top, peaceT);
    const skyMid = lerpColor(SKY_DAY.mid, SKY_SUNSET.mid, peaceT);
    const skyBot = lerpColor(SKY_DAY.bot, SKY_SUNSET.bot, peaceT);
    // Sunset → night blend
    const top = lerpColor(skyTop, BEDROCK.top, hingeT);
    const mid = lerpColor(skyMid, BEDROCK.mid, hingeT);
    const bot = lerpColor(skyBot, BEDROCK.bot, hingeT);
    return { top, mid, bot, peaceT, hingeT };
  }

  function paintSky(state, colors) {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0.00, rgb(colors.top));
    grad.addColorStop(0.55, rgb(colors.mid));
    grad.addColorStop(1.00, rgb(colors.bot));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  // ── Structural ridge marker ──────────────────────────────────────────
  // A faint horizontal band at the canonical ridgeline so we can see, in
  // this pass, where the mountain SILHOUETTE will sit and how the copy
  // slots align relative to it. Replaced by the real procedural ridge in
  // the next pass.
  function paintStructuralRidgeMarker(state, colors) {
    if (state.progress >= BAND.hingeEnd) return; // ridge gone in bedrock
    const ridgeY = h * 0.72;
    ctx.fillStyle = rgba([0,0,0], 0.05 + 0.10 * (1 - state.hingeT));
    ctx.fillRect(0, ridgeY - 1, w, 2);
    if (debug) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.font = '11px ui-monospace, Menlo, monospace';
      ctx.fillText('ridge marker (structural)', 8, ridgeY - 4);
    }
  }

  // ── Stars (night side only) ──────────────────────────────────────────
  // Deterministic — fixed seed so they don't shimmer-jump on resize.
  const STAR_COUNT = 80;
  const stars = [];
  function seedStars() {
    stars.length = 0;
    // Mulberry32 PRNG with fixed seed for reproducibility.
    let s = 0x6F75FF;
    const rnd = () => {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = 0; i < STAR_COUNT; i++) {
      stars.push({
        x: rnd(),       // 0..1 of width
        y: rnd() * 0.7, // upper 70% of canvas only
        r: 0.4 + rnd() * 1.2,
        tw: rnd() * Math.PI * 2,
      });
    }
  }
  seedStars();

  function paintStars(state) {
    // Fade in after hinge.
    const alpha = state.hingeT;
    if (alpha <= 0) return;
    ctx.save();
    for (const star of stars) {
      const twinkle = 0.65 + 0.35 * Math.sin(state.time * 0.001 + star.tw);
      ctx.globalAlpha = alpha * twinkle * 0.9;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(star.x * w, star.y * h, star.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /* ─── Real-art hooks (empty in this pass) ──────────────────────────── */
  function paintSun(state, colors) { /* TODO: port from climb_card.dart sun block */ }
  function paintClouds(state, colors) { /* TODO: port _drawCloud + drift */ }
  function paintBirds(state, colors) { /* TODO: port _drawBird + drift */ }
  function paintMountain(state, colors) { /* TODO: procedural ridge */ }
  function paintClimbLine(state) { /* TODO: continuous climb line */ }
  function paintOnboardingBalls(state) { /* TODO: port why_slide_one_animation.dart */ }

  /* ─── Frame ───────────────────────────────────────────────────────── */
  let startTime = performance.now();
  let lastDriftT = 0;

  function paintScene(now) {
    const time = now - startTime;
    // Cloud / bird drift cycles in ~24s. Independent of scroll.
    const driftPeriodMs = 24000;
    const driftT = reduced ? 0 : (time % driftPeriodMs) / driftPeriodMs;
    lastDriftT = driftT;

    const state = {
      progress,
      act: actFor(progress),
      w, h, dpr, time, driftT, reduced,
      hingeT: 0, peaceT: 0,
    };
    const colors = computeColors(state);
    state.peaceT = colors.peaceT;
    state.hingeT = colors.hingeT;

    paintSky(state, colors);
    paintSun(state, colors);
    paintClouds(state, colors);
    paintBirds(state, colors);
    paintMountain(state, colors);
    paintStructuralRidgeMarker(state, colors);
    paintClimbLine(state);
    paintOnboardingBalls(state);
    paintStars(state);

    if (debug) {
      $hud.textContent =
        `progress  ${progress.toFixed(3)}\n` +
        `act       ${state.act}\n` +
        `peaceT    ${state.peaceT.toFixed(2)}\n` +
        `hingeT    ${state.hingeT.toFixed(2)}\n` +
        `driftT    ${driftT.toFixed(2)}\n` +
        `viewport  ${w}×${h} @${dpr}x`;
    }
  }

  /* ─── Nav fade-in ─────────────────────────────────────────────────── */
  function updateNav() {
    const visible = progress >= BAND.climbEnd;
    if ($nav.dataset.visible !== String(visible)) {
      $nav.dataset.visible = String(visible);
    }
  }

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
    updateNav();
    if (reduced) {
      // Force a single repaint per scroll event in reduced-motion mode.
      needsScrollRepaint = true;
      if (!rafId) rafId = requestAnimationFrame(tick);
    }
  }
  function onResize() {
    resize();
    updateProgress();
    updateNav();
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
