/* ===========================================================================
   why-scene.js  ·  Structural pass
   ---------------------------------------------------------------------------
   This is the wiring layer for the /why-risers-works/ scene. It owns:

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
       driftT,           // [0,1] cycling for clouds/planes at rest
       w, h,             // viewport pixels (DPR-aware draw uses ctx scale)
       dpr,              // device pixel ratio
       reduced,          // user prefers reduced motion
       time              // ms since start (paused while offscreen)
     }
   ========================================================================= */

(() => {
  'use strict';

  const $scene   = document.getElementById('scene');
  const $stage   = document.querySelector('.scene-stage');
  const $canvas  = document.getElementById('sceneCanvas');
  const $nav     = document.getElementById('whyNav');
  const $hud     = document.getElementById('sceneHud');
  const $copyTop = document.getElementById('copyTop');
  const $copyBot = document.getElementById('copyBot');
  const $scrollHint = document.getElementById('scrollHint');
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
  //   progress 0.6 →  0.35  (locked HIGH so the bedrock area below the
  //                          mountain takes up ~65% of the viewport,
  //                          giving the bedrock copy block plenty of
  //                          breathing room. We deliberately accept
  //                          losing some of the sunset sky at the top.)
  const RIDGE_LOCK_PROGRESS = 0.6;
  const RIDGE_BASELINE_START = 1.08;
  const RIDGE_BASELINE_LOCKED = 0.35;

  function ridgeBaselineFrac(progress) {
    const t = Math.min(1, progress / RIDGE_LOCK_PROGRESS);
    const eased = easeInOutCubic(t);
    return RIDGE_BASELINE_START
         + (RIDGE_BASELINE_LOCKED - RIDGE_BASELINE_START) * eased;
  }

  /* ─── Climb line geometry ─────────────────────────────────────────────
     The page's composition is TWO LAYERED MOUNTAINS:

       FRONT mountain (RIDGE_PROFILE below): smaller, dark navy. This is
         the "bedrock" — what fills the lower half of the screen. The
         gray solo ball plunges down this one (Stage 3).
       BACK mountain (CLIMB_LINE + paintLavenderRidge): larger, lavender
         body, behind the front mountain. The 4 blue balls ascend this
         one. The climb line is its visible ridge silhouette.

     The CLIMB LINE has two halves:
       LEFT (smooth)  — a smooth quadratic curve that hugs the front
         mountain's slope, giving the impression that the back mountain
         emerges from behind the front. Indices 0 → CLIMB_SMOOTH_END.
       RIGHT (jagged) — a stair-step plot-graph polyline going up-right
         with multiple small dips/peaks. The 4 balls cluster on this
         side, with small "graph dots" at every data point making the
         line read as both a plotted progress chart AND a mountain ridge.

     Points are { x, dy } where dy is viewport-h above ridge baseline. */
  const CLIMB_LINE = [
    // ── Smooth left half — uses the SAME x values as the front mountain's
    //    ascending control points, each one offset by exactly 0.04 in dy
    //    above the corresponding mountain point. Because both curves use
    //    the same quadratic-through-midpoints smoothing AND identical x
    //    cadence, the climb line traces an arc perfectly parallel to the
    //    mountain ridge. Then diverges UP at the peak. ──
    { x: -0.02, dy: 0.03 },  //  0 — off-canvas, just above baseline
    { x:  0.00, dy: 0.04 },  //  1 — 0.04 above front mtn (0.00, 0.00)
    { x:  0.05, dy: 0.07 },  //  2 — 0.04 above front mtn (0.05, 0.03)
    { x:  0.10, dy: 0.11 },  //  3 — 0.04 above front mtn (0.10, 0.07)
    { x:  0.15, dy: 0.15 },  //  4 — 0.04 above front mtn (0.15, 0.11)
    { x:  0.20, dy: 0.19 },  //  5 — 0.04 above front mtn (0.20, 0.15)
    { x:  0.25, dy: 0.23 },  //  6 — 0.04 above front mtn (0.25, 0.19)
    { x:  0.28, dy: 0.25 },  //  7 — 0.04 above front mtn peak (0.21)
    { x:  0.32, dy: 0.30 },  //  8 — diverges UP while front drops to 0.18
    { x:  0.36, dy: 0.34 },  //  9 — end of smooth section
    // ── Jagged right half — a clean ascending STAIRCASE, echoing the
    //    in-app Climb card's progress line: four distinct shoulders, each
    //    reached by a rise then a shallow pullback. Fewer points than
    //    before (was 15) so it reads as a calm climb, not a busy zigzag —
    //    important on mobile where the line fills most of the frame. The
    //    four balls perch on the rises up to each shoulder. ──
    // A climbing RIDGE that doubles as a plotted progress chart: four real
    // peaks, each higher than the last, separated by shallow pullbacks. The
    // peaks give it mountain character + chart character; the quadratic
    // smoothing in computeClimbGeometry rounds the apexes so it reads as a
    // ridge, not a harsh sawtooth. Balls ride the rises between the peaks.
    { x: 0.43, dy: 0.35 },  // 10 — pullback off the smooth crest
    { x: 0.50, dy: 0.43 },  // 11 — peak 1
    { x: 0.57, dy: 0.39 },  // 12 — dip
    { x: 0.64, dy: 0.48 },  // 13 — peak 2 (higher)
    { x: 0.71, dy: 0.44 },  // 14 — dip
    { x: 0.78, dy: 0.53 },  // 15 — peak 3 (higher)
    { x: 0.85, dy: 0.49 },  // 16 — dip
    { x: 0.91, dy: 0.58 },  // 17 — peak 4 (front, highest)
    { x: 1.12, dy: 0.65 },  // 18 — final climb off the right edge
  ];
  const CLIMB_SMOOTH_END = 9;  // last index of the smooth section

  /* The 4 blue balls — each placed on a fractional position BETWEEN two
     climb-line control points so they don't all sit at the perfect tip
     of a peak/dip. Some are on up-steps, some on down-steps, varied
     positions matching a Pixar-style cluster personality:
       LEADER     — out front, on a strong ascending step
       FOLLOWER_A — twin, close to Follower B on a shared upslope
       FOLLOWER_B — other twin, paired tight with A
       HESITATOR  — way back, on a descending step, being dragged along

     Each entry: { idx, frac, phase }
       idx   = climb-line segment START index (i, point pair is i → i+1)
       frac  = 0..1 fraction along that segment
       phase = sine-bob phase offset (radians) so balls bob out of sync */
  const BALL_POSITIONS = [
    // Evenly spread along the climb so they never collide — one per rise,
    // each anchored to a segment midpoint (which lies exactly on the smooth
    // curve). frac 0.5 = the on-curve midpoint; the small variations just
    // give the group a looser, less mechanical spacing. Back → front:
    // hesitator trailing, two followers, leader out ahead.
    { idx: 10, frac: 0.55, phase: 1.8 },  // HESITATOR — trailing
    { idx: 12, frac: 0.50, phase: 1.1 },  // FOLLOWER_B
    { idx: 14, frac: 0.50, phase: 0.7 },  // FOLLOWER_A
    { idx: 16, frac: 0.45, phase: 0.0 },  // LEADER — out front
  ];

  // ── Narrow-screen variant ───────────────────────────────────────────
  // On a tall, narrow phone the desktop line compresses into a steep,
  // busy climb. Below MOBILE_MAX_W we swap in a gentler profile: only
  // three peaks and a lower overall rise, so it reads as a calm plotted
  // graph instead of a steep zigzag.
  const MOBILE_MAX_W = 700;
  const CLIMB_LINE_MOBILE = [
    // Indices 0–7 HUG the front mountain: same x as RIDGE_PROFILE's ascent,
    // each lifted 0.04 above it, so the climb line rides just over the dark
    // ridge until the summit (it must never let the dark peak poke through).
    { x: -0.02, dy: 0.03 },  // 0 — off-canvas foothill
    { x:  0.00, dy: 0.04 },  // 1
    { x:  0.05, dy: 0.07 },  // 2
    { x:  0.10, dy: 0.11 },  // 3
    { x:  0.15, dy: 0.15 },  // 4
    { x:  0.20, dy: 0.19 },  // 5
    { x:  0.25, dy: 0.23 },  // 6
    { x:  0.28, dy: 0.25 },  // 7 — just above the front summit (peak 0.21)
    // Past the summit the front ridge drops away and the climb line diverges
    // UP with three gentle peaks (fewer + lower than desktop, so a narrow
    // phone doesn't get a steep, busy zigzag).
    { x:  0.44, dy: 0.30 },  // 8 — peak 1
    { x:  0.55, dy: 0.27 },  // 9 — dip
    { x:  0.70, dy: 0.34 },  // 10 — peak 2
    { x:  0.81, dy: 0.31 },  // 11 — dip
    { x:  0.95, dy: 0.39 },  // 12 — peak 3 (front)
    { x:  1.20, dy: 0.46 },  // 13 — final climb off the right edge
  ];
  const BALL_POSITIONS_MOBILE = [
    { idx: 7,  frac: 0.55, phase: 1.8 },  // HESITATOR — trailing, just past the summit
    { idx: 9,  frac: 0.50, phase: 1.1 },  // FOLLOWER_B — rise to peak 2
    { idx: 11, frac: 0.35, phase: 0.7 },  // FOLLOWER_A — climbing to peak 3
    { idx: 11, frac: 0.80, phase: 0.0 },  // LEADER — cresting peak 3
  ];
  // Active profile by viewport width. computeClimbGeometry and
  // paintBlueBalls MUST read from here so the line and balls always agree.
  function activeClimb() {
    return w < MOBILE_MAX_W
      ? { line: CLIMB_LINE_MOBILE, balls: BALL_POSITIONS_MOBILE }
      : { line: CLIMB_LINE, balls: BALL_POSITIONS };
  }

  const BALL_BOB_AMPLITUDE_PX = 4;                 // peak vertical drift
  const BALL_BOB_PERIOD_MS    = 2400;              // one full sine cycle

  /* Gray solo ball — placed at the bottom of the front mountain's right
     slope (just past the steep cliff drop). Static — its stillness is
     the metaphor: motivation fades, the solo journey doesn't complete. */
  const GRAY_BALL_X_FRAC = 0.52;

  // FRONT mountain silhouette — SMALLER now (peak height 0.21, was 0.27).
  // This is the foreground bedrock mountain. The back mountain (climb
  // line + lavender) sits behind it and rises much higher.
  //   x:    fraction of canvas width
  //   peak: how far above baseline (in viewport-h units)
  const RIDGE_PROFILE = [
    { x: 0.00, peak: 0.00 },
    { x: 0.05, peak: 0.03 },
    { x: 0.10, peak: 0.07 },
    { x: 0.15, peak: 0.11 },
    { x: 0.20, peak: 0.15 },
    { x: 0.25, peak: 0.19 },
    { x: 0.28, peak: 0.21 },  // ← front summit (smaller)
    { x: 0.32, peak: 0.18 },
    { x: 0.37, peak: 0.13 },
    { x: 0.43, peak: 0.07 },  // steep drop
    { x: 0.50, peak: 0.03 },
    { x: 0.60, peak: 0.01 },
    { x: 0.75, peak: 0.00 },
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

  // Cloud / plane drift cycles in ~24s. Independent of scroll.
  const DRIFT_PERIOD_MS = 24000;

  // Drift cycles the cloud (L→R) and planes (R→L) over a wraparound span,
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
    // Sun starting Y (peace=0): just below the floating nav so it reads as
    // a rising morning sun on landing, not a sliver hidden behind the nav.
    // ~7svh from the top → sun center clears the nav glass on both mobile
    // and desktop while still leaving room to descend toward sunYLow.
    const sunYHigh = h * 0.07;
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

  /* ─── PLANES + TOWED BANNERS ──────────────────────────────────────────
     Two vintage biplanes in Risers colors fly R→L across the sky band,
     each towing a fabric advertising banner the way beach planes really
     do. (These replaced the original birds — a port of climb_card.dart's
     _drawBird — because the sky needed to carry a message.)

     The two banners are one sentence split in half, so the planes fly as
     a FORMATION (one drift phase, second plane a fixed fraction of a lap
     behind) and always read left-to-right. Independent phases made the
     halves swap order whenever one plane wrapped around the edge.

     Both fade out as the sky turns to dusk — this is a landing-act gag
     and has no business in the sunset payoff frame. */
  const PLANE_BANNERS = [
    { text: "You're not a quitter!" },
    { text: 'You just need', icon: true },
  ];

  // Same asset the page preloads for the equation, so this is a cache hit.
  const bannerIcon = new Image();
  bannerIcon.decoding = 'async';
  let bannerIconReady = false;
  bannerIcon.addEventListener('load', () => { bannerIconReady = true; });
  bannerIcon.src = '/assets/Risers-Icon1-Shadows-Outline.png';

  // Uniform size multiplier on the plane art. The towed banner's type is
  // sized off the viewport, not off pw, so shrinking the planes leaves the
  // lettering just as readable — only the aircraft (and its tow rope) shrink.
  const PLANE_SCALE = 0.70;
  // Dead air on a fresh load before the first plane noses in from the right.
  const PLANE_ENTRY_DELAY_MS = 7000;

  const PLANE_BODY  = '#6F75FF';   // --brand-primary
  const PLANE_DEEP  = '#292D91';   // --brand-primary-dark
  const PLANE_LIGHT = '#CFD1FF';   // --brand-primary-light

  /* The plane is authored once in a local 100-unit-long box: nose at x=0,
     tail at x≈90, fuselage centerline at y=0, nose pointing LEFT (the
     direction of travel). The caller translates + scales it, so every
     coordinate below can stay readable. */
  function _drawPlane(cx, cy, pw, alpha, spin) {
    const u = pw / 100;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx - pw / 2, cy);
    ctx.scale(u, u);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Propeller — a faint disc for the blur, plus one blade caught
    // mid-rotation so the spin reads at a glance. Kept slim so it doesn't
    // clot into a dark blob at this size.
    ctx.fillStyle = 'rgba(41,45,145,0.14)';
    ctx.beginPath();
    ctx.ellipse(1, -1, 2.2, 21, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(41,45,145,0.5)';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(1, -1 - 20 * Math.cos(spin));
    ctx.lineTo(1, -1 + 20 * Math.cos(spin));
    ctx.stroke();

    // Tail — fin above the boom, stabilizer behind it.
    ctx.fillStyle = PLANE_DEEP;
    ctx.beginPath();
    ctx.moveTo(66, -8);
    ctx.lineTo(80, -30);
    ctx.quadraticCurveTo(85, -32, 88, -27);
    ctx.lineTo(90, -6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = PLANE_LIGHT;
    ctx.beginPath();
    ctx.ellipse(88, -2, 12, 3.2, 0, 0, Math.PI * 2);
    ctx.fill();

    // Fuselage — tapered body, nose rounded, tail boom narrowing.
    ctx.fillStyle = PLANE_BODY;
    ctx.beginPath();
    ctx.moveTo(10, -12);
    ctx.bezierCurveTo(28, -16, 52, -16, 68, -12);
    ctx.lineTo(88, -6);
    ctx.quadraticCurveTo(92, 0, 88, 5);
    ctx.lineTo(68, 10);
    ctx.bezierCurveTo(52, 14, 28, 14, 10, 11);
    ctx.quadraticCurveTo(0, 6, 0, -1);
    ctx.quadraticCurveTo(0, -8, 10, -12);
    ctx.closePath();
    ctx.fill();

    // Livery stripe along the belly + the darker nose spinner.
    ctx.save();
    ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fillRect(0, 2.5, 96, 5);
    ctx.restore();
    ctx.fillStyle = PLANE_DEEP;
    ctx.beginPath();
    ctx.ellipse(6, -1, 5, 8.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Cockpit bump + window.
    ctx.fillStyle = PLANE_DEEP;
    ctx.beginPath();
    ctx.moveTo(44, -14);
    ctx.quadraticCurveTo(54, -25, 66, -13);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(223,232,255,0.95)';
    ctx.beginPath();
    ctx.ellipse(54, -16, 5.5, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    // Landing gear — far wheel first so the near one reads in front.
    ctx.strokeStyle = PLANE_DEEP;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(34, 8); ctx.lineTo(40, 20);
    ctx.moveTo(26, 8); ctx.lineTo(28, 20);
    ctx.stroke();
    ctx.fillStyle = 'rgba(41,45,145,0.55)';
    ctx.beginPath();
    ctx.arc(40, 22, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PLANE_DEEP;
    ctx.beginPath();
    ctx.arc(28, 23, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PLANE_LIGHT;
    ctx.beginPath();
    ctx.arc(28, 23, 2.6, 0, Math.PI * 2);
    ctx.fill();

    // Lower wing — drawn over the fuselage so it reads as the near wing.
    ctx.fillStyle = PLANE_LIGHT;
    ctx.beginPath();
    ctx.ellipse(46, 9, 26, 3.6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Biplane struts in the gap between fuselage and top wing.
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(30, -30); ctx.lineTo(28, -12);
    ctx.moveTo(70, -30); ctx.lineTo(68, -12);
    ctx.moveTo(32, -30); ctx.lineTo(66, -12);
    ctx.moveTo(66, -30); ctx.lineTo(32, -12);
    ctx.stroke();

    // Upper wing — the biggest shape, painted last so it sits on top.
    ctx.fillStyle = PLANE_LIGHT;
    ctx.beginPath();
    ctx.ellipse(48, -32, 32, 4.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PLANE_BODY;
    ctx.fillRect(40, -35, 14, 5.5);

    ctx.restore();
  }

  /* The banner is real fabric, not a card: a long ribbon that ripples on a
     travelling sine wave, stiff at the leading pole and flapping harder
     toward the free end, finished with a swallowtail cut. The lettering
     rides the same wave — each glyph is placed on the centerline and
     rotated to the local slope — which is what sells it as cloth. */
  function _drawTowedBanner(banner, cx, cy, pw, alpha, time, reducedMotion) {
    if (alpha <= 0.02) return;
    const fontSize = Math.max(12, Math.min(w * 0.0135, 18));
    const padX = fontSize * 1.0;
    const iconSize = banner.icon ? fontSize * 1.45 : 0;
    const iconGap  = banner.icon ? fontSize * 0.45 : 0;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `700 ${fontSize}px Inter, system-ui, sans-serif`;
    ctx.textBaseline = 'middle';

    const textW = ctx.measureText(banner.text).width;
    const notch = fontSize * 0.85;                       // swallowtail depth
    const len = textW + iconGap + iconSize + padX * 2 + notch;
    const hgt = fontSize * 2.15;

    // Planes fly right → left, so the banner streams out BEHIND them.
    const ropeLen = Math.max(14, pw * 0.30);
    const x0 = cx + pw * 0.5 + ropeLen;
    const xEnd = x0 + len;

    // Travelling ripple. Amplitude grows toward the free end because the
    // leading edge is held rigid by its pole.
    const amp = hgt * 0.24;
    const k = (Math.PI * 2) / Math.max(60, len * 0.62);
    const phase = reducedMotion ? 0.9 : -time * 0.0032;
    const waveAt = (x) => {
      const t = Math.max(0, Math.min(1, (x - x0) / len));
      return Math.sin(k * (x - x0) + phase) * amp * (0.12 + 0.88 * t);
    };

    // Tow rope — sags slightly under its own weight.
    ctx.strokeStyle = 'rgba(41,45,145,0.45)';
    ctx.lineWidth = Math.max(1, pw * 0.014);
    ctx.beginPath();
    ctx.moveTo(cx + pw * 0.44, cy + pw * 0.02);
    ctx.quadraticCurveTo(
      (cx + pw * 0.44 + x0) / 2, cy + pw * 0.05,
      x0, cy + waveAt(x0)
    );
    ctx.stroke();

    // Ribbon outline: top edge out, swallowtail, bottom edge back.
    const N = 22;
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const x = x0 + (len * i) / N;
      const y = cy + waveAt(x) - hgt / 2;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.lineTo(xEnd - notch, cy + waveAt(xEnd - notch));
    ctx.lineTo(xEnd, cy + waveAt(xEnd) + hgt / 2);
    for (let i = N; i >= 0; i--) {
      const x = x0 + (len * i) / N;
      ctx.lineTo(x, cy + waveAt(x) + hgt / 2);
    }
    ctx.closePath();

    // Cloth shading — a gradient whose stops follow the same wave, so the
    // troughs fall into shadow and the crests catch the light.
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    ctx.fill();
    const grad = ctx.createLinearGradient(x0, 0, xEnd, 0);
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      const s = Math.cos(k * (len * t) + phase);   // +1 crest, -1 trough
      grad.addColorStop(t, `rgba(90,100,180,${(0.10 * (0.5 - 0.5 * s)).toFixed(3)})`);
    }
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(41,45,145,0.30)';
    ctx.lineWidth = Math.max(1, fontSize * 0.07);
    ctx.stroke();

    // Leading pole — the rigid edge the rope is tied to.
    ctx.strokeStyle = PLANE_DEEP;
    ctx.lineWidth = Math.max(2, fontSize * 0.2);
    ctx.beginPath();
    ctx.moveTo(x0, cy + waveAt(x0) - hgt * 0.62);
    ctx.lineTo(x0, cy + waveAt(x0) + hgt * 0.62);
    ctx.stroke();

    // Lettering rides the wave, glyph by glyph.
    ctx.fillStyle = '#1C1C24';
    let cursor = x0 + padX;
    for (const ch of banner.text) {
      const cw = ctx.measureText(ch).width;
      const x = cursor + cw / 2;
      const slope = (waveAt(x + 3) - waveAt(x - 3)) / 6;
      ctx.save();
      ctx.translate(x, cy + waveAt(x));
      ctx.rotate(Math.atan(slope));
      ctx.fillText(ch, -cw / 2, 0);
      ctx.restore();
      cursor += cw;
    }
    // The icon is the last "word" — same wave, same tilt.
    if (banner.icon && bannerIconReady) {
      const x = cursor + iconGap + iconSize / 2;
      const slope = (waveAt(x + 3) - waveAt(x - 3)) / 6;
      ctx.save();
      ctx.translate(x, cy + waveAt(x));
      ctx.rotate(Math.atan(slope));
      ctx.drawImage(bannerIcon, -iconSize / 2, -iconSize / 2, iconSize, iconSize);
      ctx.restore();
    }
    ctx.restore();
  }

  function paintPlanes(state) {
    const peace = state.peaceT;
    const pw1 = Math.max(54, Math.min(w * 0.072, 104)) * PLANE_SCALE;
    const pw2 = pw1 * 0.88;
    const y1 = h * 0.115;
    const y2 = h * 0.185;
    const span = driftSpan();
    // Formation: one drift phase, trailing plane a fixed fraction of a lap
    // behind, so the two banner halves never swap reading order.
    const TRAIL_GAP = 0.16;
    // Planes fly on their own clock, offset by PLANE_ENTRY_DELAY_MS, so the
    // sky is empty for the first few seconds of a fresh load and the reader
    // gets the equation before the banners sail through it. `lap` is
    // unbounded (not wrapped) so the trailing plane can sit at a NEGATIVE
    // phase during that first pass — parked off the right edge — rather than
    // wrapping around and appearing on the left immediately.
    const lap = Math.max(0, state.time - PLANE_ENTRY_DELAY_MS) / DRIFT_PERIOD_MS;
    const lapTrail = lap - TRAIL_GAP;
    // With reduced motion there's no animation to delay, so park the pair
    // left-of-center with both banners fully on screen.
    const tLead  = state.reduced ? 0.62 : lap % 1.0;
    const tTrail = state.reduced ? (0.62 + 1 - TRAIL_GAP) % 1.0
                                 : (lapTrail < 0 ? lapTrail : lapTrail % 1.0);
    // _drawPlane treats cx as the CENTER of the plane's box and draws pw/2 to
    // the left of it, so the phase-0 parking spot has to clear that much or a
    // sliver of nose stays pinned to the right edge for the whole delay.
    const parkX = (pw) => w + pw * 0.5 + 6;
    const xLead  = parkX(pw1) - tLead  * span;
    const xTrail = parkX(pw2) - tTrail * span;
    // Banners fade out first, then the planes themselves: by the sunset
    // payoff frame the sky is empty again, so the gag never sits on top of
    // the quiet ending. Brand-colored planes ghosting over an orange dusk
    // sky looked out of place at any opacity.
    const planeAlpha  = Math.max(0, 1 - peace * 1.3);
    const bannerAlpha = Math.max(0, 1 - peace * 1.7);
    const spin = state.reduced ? 0.6 : state.time * 0.02;
    _drawPlane(xLead,  y1, pw1, planeAlpha, spin);
    _drawPlane(xTrail, y2, pw2, planeAlpha * 0.92, spin + 1.7);
    _drawTowedBanner(PLANE_BANNERS[0], xLead,  y1, pw1, bannerAlpha, state.time, state.reduced);
    _drawTowedBanner(PLANE_BANNERS[1], xTrail, y2, pw2, bannerAlpha * 0.96, state.time + 900, state.reduced);
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

  /* Compute climb line geometry once per frame. Builds two Path2Ds:
       linePath — open path used for stroking the climb line + graph dots.
                  Smooth quadratic curves on the left (indices 0 →
                  CLIMB_SMOOTH_END), then jagged lineTo segments on the
                  right (CLIMB_SMOOTH_END → end).
       polyPath — closed polygon with the SAME top edge, plus right side
                  dropping to canvas bottom, across, and back up. This is
                  the lavender BACK MOUNTAIN BODY's fillable shape.
     Shared by paintLavenderRidge / paintClimbLine / paintClimbDots /
     paintBlueBalls. */
  function computeClimbGeometry(state, geom) {
    const baselineY = geom.baselineY;
    const pts = activeClimb().line.map(p => ({
      x: p.x * w,
      y: baselineY - p.dy * h,
    }));

    const linePath = new Path2D();
    const polyPath = new Path2D();
    linePath.moveTo(pts[0].x, pts[0].y);
    polyPath.moveTo(pts[0].x, pts[0].y);

    // ── Straight segments through every point — a PLOTTED progress line
    //    with pointed corners, exactly like the in-app Climb card's polyline
    //    (climb_card.dart draws it with lineTo + round joins). No curves:
    //    the angular peaks are what make it read as a chart, not a snake. ──
    for (let i = 1; i < pts.length; i++) {
      linePath.lineTo(pts[i].x, pts[i].y);
      polyPath.lineTo(pts[i].x, pts[i].y);
    }
    // Close polygon down to canvas bottom
    const last = pts[pts.length - 1];
    polyPath.lineTo(last.x, h);
    polyPath.lineTo(pts[0].x, h);
    polyPath.closePath();

    let minY = pts[0].y, maxY = pts[0].y;
    for (const p of pts) {
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    return { pts, linePath, polyPath, minY, maxY };
  }

  /* LAVENDER RIDGE — the BACK MOUNTAIN'S BODY. A semi-transparent
     lavender fill that sits BEHIND the front mountain (the dark navy
     bedrock polygon). The lavender extends down past the front mountain
     silhouette into the bedrock area, where the dark navy paints OVER
     it and occludes everything below the silhouette. The visible
     lavender is therefore the area between the climb line (top) and
     the front mountain silhouette (bottom-left) / bedrock (bottom-right).

     Color: cool lavender → dusty purple with peace. More saturated and
     less faded than the previous "subtle wash" so the back mountain
     reads as a real second mountain, not a haze. */
  function paintLavenderRidge(state, geom, climb) {
    const peace = state.peaceT;
    const top = climb.minY;
    ctx.save();
    ctx.clip(climb.polyPath);

    // 1. Atmospheric body — a sunlit upper slope that fades into haze toward
    //    its base. Alpha falls off downward so the far massif recedes into
    //    the sky near the horizon rather than reading as a flat purple slab.
    const bodyTop = lerpColor('#BFBEEC', '#C7A6CE', peace);
    const bodyBot = lerpColor('#9498CF', '#765F95', peace);
    const vGrad = ctx.createLinearGradient(0, top, 0, h);
    vGrad.addColorStop(0.00, rgba(bodyTop, 0.80));
    vGrad.addColorStop(0.42, rgba(bodyTop, 0.56));
    vGrad.addColorStop(0.78, rgba(bodyBot, 0.30));
    vGrad.addColorStop(1.00, rgba(bodyBot, 0.10));
    ctx.fillStyle = vGrad;
    ctx.fillRect(0, top, w, h - top);

    // 2. Directional light — the sun sits on the left, so the near (left)
    //    slopes catch a warm wash while the far (right) slopes fall into
    //    cool shade. The lit-to-shadow gradient across the face gives the
    //    massif volume instead of one flat tone.
    const warm = lerpColor('#FFE3C6', '#FFC197', peace);
    const warmGrad = ctx.createLinearGradient(0, 0, w * 0.62, 0);
    warmGrad.addColorStop(0.00, rgba(warm, 0.18 + 0.20 * peace));
    warmGrad.addColorStop(1.00, rgba(warm, 0));
    ctx.fillStyle = warmGrad;
    ctx.fillRect(0, top, w, h - top);

    const shade = lerpColor('#5C61A8', '#3C3164', peace);
    const shadeGrad = ctx.createLinearGradient(w * 0.45, 0, w, 0);
    shadeGrad.addColorStop(0.00, rgba(shade, 0));
    shadeGrad.addColorStop(1.00, rgba(shade, 0.22 + 0.18 * peace));
    ctx.fillStyle = shadeGrad;
    ctx.fillRect(0, top, w, h - top);

    ctx.restore();
  }

  /* CLIMB LINE — the back mountain's ridge silhouette. Stroked along
     the top edge of the lavender body. Smooth quadratic on the left
     half (where it hugs the front mountain's profile) and jagged
     stair-step on the right half (plot-chart character + the 4 balls). */
  function paintClimbLine(state, geom, climb) {
    const strokeW = Math.max(3, w * 0.0035);
    ctx.save();
    ctx.lineCap = 'round';
    // Sharp (mitered) joins so the peaks read as crisp plotted-graph corners,
    // not rounded-off bumps.
    ctx.lineJoin = 'miter';
    ctx.miterLimit = 12;
    ctx.lineWidth = strokeW;
    ctx.strokeStyle = '#6F75FF';
    ctx.stroke(climb.linePath);
    ctx.restore();
  }

  /* CLIMB DOTS — small Risers-purple data points at every JAGGED-section
     control point that doesn't already have a big blue ball. Reinforces
     the "plotted progress chart" reading and gives the right-side ridge
     line its dot-marker character à la WHY slide 1's Risers line. */
  function paintClimbDots(state, geom, climb) {
    const dotR = Math.max(3.5, w * 0.0035);
    const ballSet = new Set([
      BALL_INDICES.HESITATOR, BALL_INDICES.FOLLOWER_B,
      BALL_INDICES.FOLLOWER_A, BALL_INDICES.LEADER,
    ]);
    ctx.save();
    ctx.fillStyle = '#6F75FF';
    // Skip the off-canvas final point (index last) and ball positions.
    for (let i = CLIMB_SMOOTH_END + 1; i < climb.pts.length - 1; i++) {
      if (ballSet.has(i)) continue;
      const p = climb.pts[i];
      ctx.beginPath();
      ctx.arc(p.x, p.y, dotR, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /* BLUE BALLS — 4 Risers-purple balls statically placed on the back
     mountain's ridge line in stair-step formation. Each one bobs up
     and down on a sine wave with its own phase offset so they feel
     alive in place without animating along the path. Reduced-motion
     users see them perfectly still. */
  function paintBlueBalls(state, geom, climb) {
    const ballR = Math.max(11, Math.min(h * 0.020, 24));
    const bobT = state.reduced ? 0 : (state.time / BALL_BOB_PERIOD_MS) * Math.PI * 2;
    // Lift each ball clearly above the line (a hair more than tangent)
    // so they read as individual characters perched ABOVE the climb,
    // not points baked into the line.
    const restOffset = ballR * 1.25;
    ctx.save();
    ctx.fillStyle = '#6F75FF';
    for (const pos of activeClimb().balls) {
      const p1 = climb.pts[pos.idx];
      const p2 = climb.pts[pos.idx + 1];
      if (!p1 || !p2) continue;
      // Linear interp along the segment so the ball can sit MID-SLOPE
      // (on the rise or fall) rather than at a perfect graph vertex.
      const x = p1.x + (p2.x - p1.x) * pos.frac;
      const y = p1.y + (p2.y - p1.y) * pos.frac;
      const bob = state.reduced
        ? 0
        : Math.sin(bobT + pos.phase) * BALL_BOB_AMPLITUDE_PX;
      ctx.beginPath();
      ctx.arc(x, y - restOffset + bob, ballR, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /* Linear-interpolated front-mountain silhouette Y at a given x fraction.
     Used by the gray ball + arc text to anchor to the visible slope. */
  function silhouetteYAt(geom, xFrac) {
    const x = xFrac * w;
    const pts = geom.pts;
    for (let i = 0; i < pts.length - 1; i++) {
      if (x >= pts[i].x && x <= pts[i + 1].x) {
        const t = (x - pts[i].x) / (pts[i + 1].x - pts[i].x);
        return pts[i].y + (pts[i + 1].y - pts[i].y) * t;
      }
    }
    return pts[pts.length - 1].y;
  }

  /* GRAY SOLO BALL — sits on the front mountain's slope just past the
     steep right cliff. Color #C6C6C6 matches why_slide_one_animation.dart:146.
     Static — no bob — the stillness is the message: the solo journey
     stopped. Slightly smaller than the blue balls so it feels diminished. */
  function paintGrayBall(state, geom) {
    const ballR = Math.max(10, Math.min(h * 0.018, 22));
    const cx = GRAY_BALL_X_FRAC * w;
    // Rest the ball ON the silhouette curve (center one radius above the
    // ridge surface so it visually sits on the slope).
    const cy = silhouetteYAt(geom, GRAY_BALL_X_FRAC) - ballR * 0.85;
    ctx.save();
    ctx.fillStyle = '#C6C6C6';
    ctx.beginPath();
    ctx.arc(cx, cy, ballR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /* ARC TEXT — "motivation fades on a solo journey" curving along the
     front mountain's silhouette, just above the ridge line in the sky
     band. Subtle by design: italic, low opacity, color lerps with peace.
     Implemented as character-by-character canvas text with each glyph
     rotated by the local tangent angle of the sampled silhouette path. */
  const ARC_TEXT = 'motivation fades on a solo journey';
  // Arc text only follows the DESCENDING right slope of the front
  // mountain so it never crosses the climb line. Starts just past the
  // peak (x=0.28) and curves down to the gray ball's footing (x=0.55).
  const ARC_TEXT_START_X = 0.29;
  const ARC_TEXT_END_X   = 0.55;
  function paintMotivationText(state, geom) {
    const peace = state.peaceT;

    // Sample the silhouette densely across the arc, offset upward into
    // the sky band so the text reads on the sky, not on the mountain.
    const samples = 80;
    const yOffset = -Math.max(16, Math.min(h * 0.025, 28));
    const arcPts = [];
    for (let i = 0; i <= samples; i++) {
      const xFrac = ARC_TEXT_START_X
                  + (ARC_TEXT_END_X - ARC_TEXT_START_X) * (i / samples);
      arcPts.push({ x: xFrac * w, y: silhouetteYAt(geom, xFrac) + yOffset });
    }

    // Cumulative arc-length table for char placement.
    const arcLens = [0];
    for (let i = 1; i < arcPts.length; i++) {
      const dx = arcPts[i].x - arcPts[i - 1].x;
      const dy = arcPts[i].y - arcPts[i - 1].y;
      arcLens.push(arcLens[i - 1] + Math.hypot(dx, dy));
    }
    const totalLen = arcLens[arcLens.length - 1];

    ctx.save();
    const fontSize = Math.max(12, Math.min(w * 0.011, 17));
    ctx.font = `italic 500 ${fontSize}px Inter, system-ui, sans-serif`;
    ctx.textBaseline = 'middle';

    // Measure full text. If wider than the path, skip (viewport too narrow).
    const textWidth = ctx.measureText(ARC_TEXT).width;
    if (textWidth > totalLen) { ctx.restore(); return; }

    // Color — cool gray at day → dusty mauve at sunset. Stays very subtle.
    const baseColor = lerpColor('#56607A', '#8E6FAA', peace);
    ctx.fillStyle = rgba(baseColor, 0.32);

    // Center the text along the arc and walk character-by-character.
    let cursor = (totalLen - textWidth) / 2;
    for (let i = 0; i < ARC_TEXT.length; i++) {
      const ch = ARC_TEXT[i];
      const chW = ctx.measureText(ch).width;
      const center = cursor + chW / 2;

      // Find the arc segment containing this character's center.
      let seg = 0;
      while (seg < arcLens.length - 2 && arcLens[seg + 1] < center) seg++;
      const segLen = arcLens[seg + 1] - arcLens[seg];
      const t = segLen > 0 ? (center - arcLens[seg]) / segLen : 0;
      const p1 = arcPts[seg];
      const p2 = arcPts[seg + 1];
      const px = p1.x + (p2.x - p1.x) * t;
      const py = p1.y + (p2.y - p1.y) * t;
      const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);

      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(angle);
      ctx.fillText(ch, -chW / 2, 0);
      ctx.restore();
      cursor += chW;
    }
    ctx.restore();
  }

  /* ─── Frame ───────────────────────────────────────────────────────── */
  let startTime = performance.now();

  function paintScene(now) {
    const time = now - startTime;
    const driftT = reduced ? 0 : (time % DRIFT_PERIOD_MS) / DRIFT_PERIOD_MS;

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
    // 3. Sky-layer art. Sun paints first so clouds/planes can fly in
    //    front of it. Sun's lower half gets clipped by the bedrock
    //    polygon later — that's how it "sets behind" the mountain.
    paintSun(state, geom);
    paintClouds(state);
    paintPlanes(state);
    // 3. BACK MOUNTAIN (lavender body) — painted FIRST so the front
    //    mountain occludes its lower portion. The visible lavender is
    //    therefore the area above the front mountain silhouette: the
    //    upper-right region where the climb line + 4 balls live.
    const climb = computeClimbGeometry(state, geom);
    paintLavenderRidge(state, geom, climb);
    // 4. FRONT MOUNTAIN — dark navy bedrock polygon paints OVER the
    //    lavender below its silhouette. Then mountain-face tint and
    //    rim-light highlight the front summit. Stars in bedrock.
    paintBedrock(state, geom);
    paintMountainFace(state, geom);
    paintRidgeRimLight(state, geom);
    paintRoot(state, geom);
    paintStars(state, geom);
    // 5. The back mountain's RIDGE LINE (stroked smooth-left + jagged-
    //    right). Then the subtle "motivation fades…" arc text floats
    //    in the sky band just above the front mountain silhouette.
    //    Finally the 4 blue balls (bobbing in place on the right) and
    //    the static gray ball (settled on the front slope) — the
    //    contrast between the alive cluster and the still solo is the
    //    visual core of the page.
    paintClimbLine(state, geom, climb);
    paintMotivationText(state, geom);
    paintBlueBalls(state, geom, climb);
    paintGrayBall(state, geom);

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

  /* ─── Static copy overlays ────────────────────────────────────────────
     The two text blocks are position: fixed in CSS and toggled visible by
     adding `.is-visible`. Thresholds map to the scroll progress where
     each block belongs visually:
       • Top overlay (surface) — visible while progress < 0.45, fades out
         as the user starts climbing into the mountain reveal.
       • Bottom overlay (underneath) — fades in past progress > 0.58
         (just after the ridge locks at the payoff frame), stays on
         while the dark area is on screen.
     Both also hide when the scene scrolls fully off the viewport so they
     don't float over the footer below. */
  // Top text starts fading out at progress 0.18 — VERY early, well
  // before the climb line's mid-segment rises into the headline's
  // vertical band (~progress 0.28). With the 0.55s CSS transition this
  // ensures the headline is fully gone by the time anything in the
  // scene would intersect it. Generous safety margin for fast scrollers.
  const TOP_FADE_OUT = 0.18;
  // Scroll-down hint hides the instant the user starts scrolling — it's
  // an invitation for stationary visitors, not a persistent indicator.
  // By the time the bottom text begins to appear (BOT_FADE_IN = 0.75)
  // the hint is long gone, satisfying the "go away before reveal" goal.
  const HINT_FADE_OUT = 0.04;
  // Bottom text holds off until progress 0.75 — well past the ridge lock
  // (0.60), so the user has scrolled most of the way and the visual scene
  // is fully settled. The bedrock copy then arrives as the "landing" beat
  // when the user is naturally at rest near the bottom of the scroll.
  const BOT_FADE_IN  = 0.75;
  function updateCopyOverlays() {
    // Cheap "is the scene actually in view" check — the .scene element
    // is the scroll container; if its rect doesn't intersect the viewport
    // we hide both overlays.
    const rect = $scene.getBoundingClientRect();
    const inView = rect.top < window.innerHeight && rect.bottom > 0;
    const showTop  = inView && progress < TOP_FADE_OUT;
    const showBot  = inView && progress > BOT_FADE_IN;
    const showHint = inView && progress < HINT_FADE_OUT;
    if ($copyTop)    $copyTop   .classList.toggle('is-visible', showTop);
    if ($copyBot)    $copyBot   .classList.toggle('is-visible', showBot);
    if ($scrollHint) $scrollHint.classList.toggle('is-hidden', !showHint);
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

  // ResizeObserver — fires immediately on observe AND every time the
  // stage's actual rendered box changes (font swap, sticky activation,
  // svh unit shifts, DPR settling late, viewport changes, ...). This
  // is the cure for the "first-load wonky/stretched scene" bug: the
  // initial `resize()` in boot can measure before layout fully settles,
  // and without this observer we'd paint to a misshapen canvas backing
  // buffer until the user triggered a manual resize.
  const ro = new ResizeObserver(() => {
    resize();
    updateProgress();
    updateCopyOverlays();
    needsScrollRepaint = true;
    if (!rafId && onscreen) rafId = requestAnimationFrame(tick);
  });
  ro.observe($stage);

  // Belt-and-suspenders: after webfonts load, force one more measure +
  // repaint. The ResizeObserver above usually catches this, but if the
  // font-swap reflow doesn't change the stage's box (only e.g. nav text
  // size), RO won't fire — this guarantees a clean post-font frame.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      resize();
      needsScrollRepaint = true;
      if (!rafId && onscreen) rafId = requestAnimationFrame(tick);
    });
  }

  // Pause when the tab is hidden.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else if (onscreen) start();
  });

  /* ─── Event wiring ────────────────────────────────────────────────── */
  function onScroll() {
    updateProgress();
    updateCopyOverlays();
    if (reduced) {
      // Force a single repaint per scroll event in reduced-motion mode.
      needsScrollRepaint = true;
      if (!rafId) rafId = requestAnimationFrame(tick);
    }
  }
  function onResize() {
    resize();
    updateProgress();
    updateCopyOverlays();
    needsScrollRepaint = true;
    if (!rafId && onscreen) rafId = requestAnimationFrame(tick);
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize);

  /* ─── Boot ────────────────────────────────────────────────────────── */
  resize();
  updateProgress();
  updateCopyOverlays();
  start();
})();
