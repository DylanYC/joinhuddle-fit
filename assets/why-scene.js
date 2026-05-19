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
  //   progress 0   →  1.08  (silhouette mostly off-screen below; peak peeks)
  //   progress 0.6 →  0.55  (silhouette peak at ~⅓ down — the payoff)
  //   progress >0.6 → locked at 0.55
  const RIDGE_LOCK_PROGRESS = 0.6;
  const RIDGE_BASELINE_START = 1.08;
  const RIDGE_BASELINE_LOCKED = 0.55;

  function ridgeBaselineFrac(progress) {
    const t = Math.min(1, progress / RIDGE_LOCK_PROGRESS);
    const eased = easeInOutCubic(t);
    return RIDGE_BASELINE_START
         + (RIDGE_BASELINE_LOCKED - RIDGE_BASELINE_START) * eased;
  }

  /* ─── Climb line geometry ─────────────────────────────────────────────
     The page's spine. One continuous stroke that ascends the gentle left
     slope of the mountain (paralleling the ridge profile, offset slightly
     above), crests at the summit where the 4-dot Huddle cluster sits,
     and continues straight down through the mountain into the bedrock
     where it dissolves into the depth.
     Points are stored as { x, dy } where dy is viewport-h above ridge baseline. */
  const CLIMB_ASCENT = [
    { x: 0.04, dy: 0.02 },  // start — far left, just emerging from the ridge baseline
    { x: 0.15, dy: 0.06 },
    { x: 0.26, dy: 0.10 },
    { x: 0.36, dy: 0.14 },
    { x: 0.45, dy: 0.19 },
    { x: 0.53, dy: 0.23 },
    { x: 0.58, dy: 0.26 },  // summit endpoint — meets the 4-dot cluster
  ];
  // How deep into bedrock the descent reaches, in viewport-h units below
  // the ridge baseline. Beyond this the line has faded fully transparent.
  const CLIMB_DESCENT_END_DY = 0.50;

  // The ridge silhouette: control points relative to the baseline.
  //   x:    fraction of canvas width
  //   peak: how far above baseline (in viewport-h units)
  // Designed for the brand "purple mountain" feel — clearly asymmetric:
  // a longer, gentler LEFT slope (where the climb line ascends) and a
  // shorter, steeper RIGHT shoulder. Subtle saddles at x=0.20 and x=0.66
  // give the silhouette character without breaking the singular summit.
  const RIDGE_PROFILE = [
    { x: 0.00, peak: 0.00 },
    { x: 0.05, peak: 0.02 },
    { x: 0.12, peak: 0.05 },
    { x: 0.20, peak: 0.07 },  // first shoulder
    { x: 0.27, peak: 0.10 },
    { x: 0.35, peak: 0.13 },
    { x: 0.42, peak: 0.17 },
    { x: 0.49, peak: 0.21 },
    { x: 0.54, peak: 0.24 },
    { x: 0.58, peak: 0.26 },  // ← summit
    { x: 0.63, peak: 0.22 },
    { x: 0.68, peak: 0.14 },
    { x: 0.74, peak: 0.10 },
    { x: 0.82, peak: 0.06 },
    { x: 0.90, peak: 0.03 },
    { x: 1.00, peak: 0.00 },
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
     painters (sun, clouds) can anchor to summit BEFORE bedrock paints.
     Returns reusable Path2D objects for the closed bedrock polygon and
     the open ridge curve so the bedrock fill, mountain-face overlay,
     and rim-light pass all share the same exact silhouette. */
  function computeRidgeGeometry(state) {
    const baselineY = h * ridgeBaselineFrac(state.progress);
    const pts = RIDGE_PROFILE.map(p => ({
      x: p.x * w,
      y: baselineY - p.peak * h,
    }));
    let summit = pts[0];
    for (const p of pts) if (p.y < summit.y) summit = p;

    // Smooth ridge curve using quadratic beziers through midpoints
    // (same pattern as climb_card.dart:1011-1026).
    const polyPath = new Path2D();
    const ridgePath = new Path2D();
    polyPath.moveTo(pts[0].x, pts[0].y);
    ridgePath.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      const my = (pts[i].y + pts[i + 1].y) / 2;
      polyPath.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
      ridgePath.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    const last = pts[pts.length - 1];
    polyPath.lineTo(last.x, last.y);
    ridgePath.lineTo(last.x, last.y);
    // Close the bedrock polygon down the right edge, across the bottom,
    // up the left edge.
    polyPath.lineTo(w, h);
    polyPath.lineTo(0, h);
    polyPath.closePath();

    return {
      baselineY,
      summitX: summit.x,
      summitY: summit.y,
      pts,
      polyPath,   // closed bedrock polygon (fillable)
      ridgePath,  // open ridge curve (strokeable)
    };
  }

  /* BEDROCK fill — deep navy gradient inside the closed ridge polygon. */
  function paintBedrock(state, geom) {
    const grad = ctx.createLinearGradient(0, geom.summitY, 0, h);
    grad.addColorStop(0.00, rgb(BEDROCK.top));
    grad.addColorStop(0.55, rgb(BEDROCK.mid));
    grad.addColorStop(1.00, rgb(BEDROCK.bot));
    ctx.fillStyle = grad;
    ctx.fill(geom.polyPath);
  }

  /* MOUNTAIN FACE — semi-transparent overlay near the ridge crest, lerped
     from cool slate at day → deep warm purple at sunset. Same color stops
     as climb_card.dart:1033-1037 (#B4C3E6 → #4A3A6E) but lifted into a
     downward-fading gradient so the mountain top reads as catching sky
     light while the deeper body fades into the bedrock fill below. */
  function paintMountainFace(state, geom) {
    const peace = state.peaceT;
    const faceColor = lerpColor('#B4C3E6', '#4A3A6E', peace);
    const faceTop = geom.summitY - 2;
    const faceBot = geom.baselineY + h * 0.08;
    if (faceBot <= faceTop) return;
    ctx.save();
    ctx.clip(geom.polyPath);
    const grad = ctx.createLinearGradient(0, faceTop, 0, faceBot);
    // Stronger at the crest, fading to transparent so the bedrock gradient
    // takes over below. Alpha intensifies with peace so the silhouette
    // reads darker at sunset (matches the app's "ridgeAlpha = 0.35 + 0.5 * peace").
    const aTop = 0.55 + 0.35 * peace;
    const aMid = 0.30 + 0.25 * peace;
    grad.addColorStop(0.00, rgba(faceColor, aTop));
    grad.addColorStop(0.50, rgba(faceColor, aMid));
    grad.addColorStop(1.00, rgba(faceColor, 0));
    ctx.fillStyle = grad;
    ctx.fillRect(0, faceTop, w, faceBot - faceTop);
    ctx.restore();
  }

  /* RIDGE RIM LIGHT — a soft warm halo along the crest at sunset. Mimics
     the band of light that catches the top edge of a mountain when the
     sun is just behind it. Painted as a blurred stroke of the open ridge
     curve (geom.ridgePath), so it follows the actual silhouette including
     all foothill bumps. */
  function paintRidgeRimLight(state, geom) {
    const peace = state.peaceT;
    if (peace < 0.08) return;
    const color = lerpColor('#FFB78A', '#FFE0B5', peace);
    ctx.save();
    ctx.strokeStyle = rgba(color, 0.45 * peace);
    ctx.lineWidth = Math.max(2, w * 0.0035);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.filter = `blur(${Math.max(1.5, w * 0.002)}px)`;
    ctx.stroke(geom.ridgePath);
    ctx.restore();
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

  /* SUN — upgraded for full-viewport scale.
     The app's flat disc + single blurred halo reads as "MS Paint" when
     scaled up. We replace with three layered passes (all radial gradients,
     which scale beautifully): wide outer bloom (sun-bleeding-into-sky),
     tight inner halo, and a disc with a bright core fading to a warm rim.
     Geometry math (sunYHigh/sunYLow/sunY/sunX) is unchanged from
     climb_card.dart:891-919 — only the rendering technique changed. */
  function paintSun(state, geom) {
    const peace = state.peaceT;
    const factor = appFactor();
    const sunR = Math.max(22, Math.min(17 * factor, 56));
    const sunYHigh = -sunR * 0.40;
    const sunYLow  = geom.summitY + sunR * 0.55;
    const sunY = sunYHigh + (sunYLow - sunYHigh) * peace;
    const sunX = geom.summitX;

    // Outer bloom — wide soft glow bleeding into the sky.
    const outerR = sunR * 5.0;
    const bloomColor = lerpColor('#FFE8B8', '#FF9E63', peace);
    const outer = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, outerR);
    outer.addColorStop(0.00, rgba(bloomColor, 0.32 + 0.32 * peace));
    outer.addColorStop(0.35, rgba(bloomColor, 0.14 + 0.18 * peace));
    outer.addColorStop(1.00, rgba(bloomColor, 0));
    ctx.fillStyle = outer;
    ctx.beginPath();
    ctx.arc(sunX, sunY, outerR, 0, Math.PI * 2);
    ctx.fill();

    // Inner halo — tighter, warmer, sits just outside the disc.
    const innerR = sunR * 2.0;
    const haloColor = lerpColor('#FFD088', '#FFA76A', peace);
    const inner = ctx.createRadialGradient(sunX, sunY, sunR * 0.3, sunX, sunY, innerR);
    inner.addColorStop(0.00, rgba(haloColor, 0.55 + 0.30 * peace));
    inner.addColorStop(0.55, rgba(haloColor, 0.22));
    inner.addColorStop(1.00, rgba(haloColor, 0));
    ctx.fillStyle = inner;
    ctx.beginPath();
    ctx.arc(sunX, sunY, innerR, 0, Math.PI * 2);
    ctx.fill();

    // Disc — bright core fading to a warm rim. No hard edge.
    const coreColor = lerpColor('#FFF6E0', '#FFE3B5', peace);
    const rimColor  = lerpColor('#FFD088', '#FF8A4C', peace);
    const disc = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR);
    disc.addColorStop(0.00, rgba(coreColor, 0.95));
    disc.addColorStop(0.65, rgba(rimColor,  0.88));
    disc.addColorStop(0.92, rgba(rimColor,  0.50));
    disc.addColorStop(1.00, rgba(rimColor,  0));
    ctx.fillStyle = disc;
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR * 1.04, 0, Math.PI * 2);
    ctx.fill();
  }

  /* CLOUDS — upgraded for full-viewport scale.
     The app's three solid blurred ovals look like puddles when scaled up.
     We replace each oval with a radial-gradient ellipse that fades from
     opaque center to fully transparent edge — no hard boundaries — and
     layer 5 of them per cloud at varied positions, sizes, and densities
     so each cloud has volume and silhouette. Subtle scale-aware blur on
     top adds atmospheric haze. */
  function _drawCloudShape(cx, cy, cw, baseColor, baseAlpha) {
    const ch = cw * 0.42;
    // Per-blob: offset (units of cw/ch), size scale, alpha multiplier.
    const blobs = [
      { ox:  0.00, oy:  0.00, sw: 1.00, sh: 1.00, a: 0.95 },
      { ox:  0.24, oy: -0.26, sw: 0.68, sh: 0.85, a: 0.85 },
      { ox: -0.24, oy:  0.06, sw: 0.58, sh: 0.72, a: 0.85 },
      { ox:  0.40, oy:  0.10, sw: 0.42, sh: 0.55, a: 0.65 },
      { ox: -0.08, oy: -0.22, sw: 0.50, sh: 0.65, a: 0.78 },
    ];
    ctx.save();
    ctx.filter = `blur(${Math.max(1.5, cw * 0.035)}px)`;
    for (const b of blobs) {
      const ecx = cx + b.ox * cw;
      const ecy = cy + b.oy * ch;
      const erx = (cw / 2) * b.sw;
      const ery = (ch / 2) * b.sh;
      const r = Math.max(erx, ery);
      const grad = ctx.createRadialGradient(ecx, ecy, 0, ecx, ecy, r);
      const a = baseAlpha * b.a;
      grad.addColorStop(0.00, rgba(baseColor, a));
      grad.addColorStop(0.55, rgba(baseColor, a * 0.55));
      grad.addColorStop(1.00, rgba(baseColor, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(ecx, ecy, erx, ery, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  function paintClouds(state) {
    const peace = state.peaceT;
    const factor = appFactor();
    const cloudW = 42 * factor;
    const cloudColor = lerpColor('#FFFFFF', '#FFD0A8', peace);
    const baseAlpha = 0.55 * (1 - 0.35 * peace);
    const span = driftSpan();
    // Two clouds at offset drift phases so the sky never feels static.
    // Sizes/positions intentionally different so they don't read as twins.
    const t1 = state.driftT;
    const t2 = (state.driftT + 0.45) % 1.0;
    _drawCloudShape(-cloudW + t1 * (span + cloudW), h * 0.11, cloudW,        cloudColor, baseAlpha);
    _drawCloudShape(-cloudW + t2 * (span + cloudW), h * 0.05, cloudW * 0.72, cloudColor, baseAlpha * 0.85);
  }

  /* BIRDS — direct port of climb_card.dart _drawBird (lines 1314-1333).
     Two quadratic arcs forming the classic "M-bird" silhouette. Two
     birds drift R→L at offset phases. Color lerps day → dusk with peace. */
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

  /* HORIZON GLOW — warm atmospheric band just above the ridge at sunset.
     Mimics the real-world scattering that makes the air near a setting sun
     glow orange-pink. Fades in with peaceT, paints between sky and sun so
     it can be partially overlapped by the sun's outer bloom. */
  function paintHorizonGlow(state, geom) {
    const peace = state.peaceT;
    if (peace < 0.03) return;
    const glowTop = Math.max(0, geom.summitY - h * 0.18);
    const glowBot = geom.baselineY + h * 0.02;
    if (glowBot <= glowTop) return;
    const color = lerpColor('#FFE0B5', '#FF8E5C', peace);
    const grad = ctx.createLinearGradient(0, glowTop, 0, glowBot);
    grad.addColorStop(0.00, rgba(color, 0));
    grad.addColorStop(0.55, rgba(color, 0.10 + 0.18 * peace));
    grad.addColorStop(1.00, rgba(color, 0.22 + 0.30 * peace));
    ctx.fillStyle = grad;
    ctx.fillRect(0, glowTop, w, glowBot - glowTop);
  }
  // Story/world layer
  function paintOnboardingBalls(state, geom) { /* TODO: port why_slide_one_animation.dart */ }
  // Bedrock features
  function paintRoot(state, geom) { /* TODO: subtle root/anchor where climb line enters bedrock */ }

  /* CLIMB LINE — the page's through-line.
     ASCENT: smooth quadratic-bezier curve through CLIMB_ASCENT control
       points, drawn as a solid Huddle-purple stroke. Decorative "showed-up"
       dots (a la the app's daily climb dots) mark intermediate points
       along the ascent, fading in with x so they read as accumulating.
     DESCENT: a straight vertical from the summit straight down to a
       bedrock anchor point. Painted with a gradient stroke that fades
       from solid purple at the summit to fully transparent at the
       bottom — the line "dissolves into the depth" instead of ending
       at a hard point.
     The 4-dot cluster (paintSummitCluster, below) crowns the summit and
     visually receives the ascent + emits the descent. */
  function paintClimbLine(state, geom) {
    const baselineY = geom.baselineY;
    const aPts = CLIMB_ASCENT.map(p => ({
      x: p.x * w,
      y: baselineY - p.dy * h,
    }));
    const strokeW = Math.max(2.5, w * 0.0028);

    // ── ASCENT — smoothed quadratic curve via midpoints ──────────────
    const ascentPath = new Path2D();
    ascentPath.moveTo(aPts[0].x, aPts[0].y);
    for (let i = 1; i < aPts.length - 1; i++) {
      const mx = (aPts[i].x + aPts[i + 1].x) / 2;
      const my = (aPts[i].y + aPts[i + 1].y) / 2;
      ascentPath.quadraticCurveTo(aPts[i].x, aPts[i].y, mx, my);
    }
    const last = aPts[aPts.length - 1];
    ascentPath.lineTo(last.x, last.y);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = strokeW;
    ctx.strokeStyle = '#6F75FF';
    ctx.stroke(ascentPath);
    ctx.restore();

    // ── DESCENT — vertical stroke with linear-alpha fadeout ──────────
    const sx = last.x;
    const sy = last.y;
    const anchorY = baselineY + CLIMB_DESCENT_END_DY * h;
    if (anchorY > sy) {
      const grad = ctx.createLinearGradient(0, sy, 0, anchorY);
      grad.addColorStop(0.00, 'rgba(111, 117, 255, 1.00)');
      grad.addColorStop(0.55, 'rgba(111, 117, 255, 0.85)');
      grad.addColorStop(1.00, 'rgba(111, 117, 255, 0.00)');
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineWidth = strokeW;
      ctx.strokeStyle = grad;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx, anchorY);
      ctx.stroke();
      ctx.restore();
    }

    // ── Ascent "showed-up" dots — skip start and summit; alpha grows ─
    const dotR = Math.max(3.2, h * 0.0050);
    ctx.save();
    for (let i = 1; i < CLIMB_ASCENT.length - 1; i++) {
      const p = CLIMB_ASCENT[i];
      const px = p.x * w;
      const py = baselineY - p.dy * h;
      const t = (i - 1) / Math.max(1, CLIMB_ASCENT.length - 3);
      const alpha = 0.55 + 0.45 * t;
      ctx.fillStyle = `rgba(111, 117, 255, ${alpha})`;
      ctx.beginPath();
      ctx.arc(px, py, dotR, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /* SUMMIT CLUSTER — the Huddle 4-dot brand mark crowning the summit.
     Diamond formation per BRAND.md §9 (top / right / bottom / left around
     a center). The ascent line ends at the cluster center and the descent
     begins from it, so the cluster reads as the receiver and origin of
     the through-line. All four dots are solid #6F75FF — no halo, per
     brand spec. */
  function paintSummitCluster(state, geom) {
    const cx = geom.summitX;
    const cy = geom.summitY;
    const spacing = Math.max(14, Math.min(h * 0.030, 32));
    const dotR = spacing * 0.55;
    ctx.save();
    ctx.fillStyle = '#6F75FF';
    const offsets = [
      [ 0,        -spacing], // top
      [ spacing,   0],       // right
      [ 0,         spacing], // bottom — sits just below silhouette, reads as on the summit
      [-spacing,   0],       // left
    ];
    for (const [dx, dy] of offsets) {
      ctx.beginPath();
      ctx.arc(cx + dx, cy + dy, dotR, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

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
    // 2. Atmospheric horizon glow — warm band just above the ridge,
    //    fades in with peace. Painted before the sun so the sun's
    //    bloom lays on top of it naturally.
    paintHorizonGlow(state, geom);
    // 3. Sky-layer art. Sun paints first so clouds/birds can fly in
    //    front of it. Sun's lower half gets clipped by the bedrock
    //    polygon later — that's how it "sets behind" the mountain.
    paintSun(state, geom);
    paintClouds(state);
    paintBirds(state);
    // 3. Bedrock polygon covers everything below the ridge with the
    //    bedrock gradient. Then a mountain-face overlay tints the area
    //    near the ridge crest with cool-slate-to-warm-purple (peace),
    //    and a rim-light pass adds a warm halo along the crest at
    //    sunset. Stars paint last so they sit visually deepest.
    paintBedrock(state, geom);
    paintMountainFace(state, geom);
    paintRidgeRimLight(state, geom);
    paintRoot(state, geom);
    paintStars(state, geom);
    // 4. World-spanning elements: the climb line ascends through the sky,
    //    crests at the summit-with-4-dots, continues straight down into
    //    bedrock. Painted last so it sits on top of both regions.
    paintClimbLine(state, geom);
    paintSummitCluster(state, geom);
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
