# Huddle Brand Guidelines
### joinhuddle.fit — Reference for Claude Code

This document is the single source of truth for all visual and voice decisions on the joinhuddle.fit website. Every value here is derived directly from the production Flutter app (`theme.dart`, `constants/layout.dart`, and component code). Do not invent new colors, fonts, or tones — stay within these guardrails.

---

## 1. Brand Identity

**Product name:** Huddle  
**Domain:** joinhuddle.fit  
**Slogan:** SHOW UP. TOGETHER.  
**App Store target:** iOS and Android  
**Positioning:** A social fitness accountability app for small, invite-only inner circles (up to 12 people) who commit to fitness and nutrition goals and prove completion with in-the-moment photos.

### What Huddle is
- Accountability through **mutual belief**, not surveillance
- Measuring **showing up** — not speed, distance, or performance
- Built for trust, vulnerability-safety, and human connection
- Anti-Strava: no leaderboards, no race-to-the-top

### What Huddle is NOT
- Not a stats tracker or performance logger
- Not a public social network
- Not competitive or judgmental
- Never frame accountability as "being watched" or "called out"

---

## 2. Voice & Tone

### Core copy principles
- **Direct and warm** — works for "a German and a Canadian." Logical but never cold; warm but never saccharine.
- **Short sentences** — Huddle copy punches. No filler.
- **Show, don't explain** — the product speaks for itself.
- **Never preachy** — trust the user; don't lecture.

### Brand copy examples (from app onboarding — use these as tone anchors)
> "Motivation fades. Your people don't."

> "Huddle is built around what actually keeps you consistent."

> "This app isn't about stats or PBs. Not who did it fastest or who went the furthest. It's about showing up, together."

> "A private group of up to 12 people. Those few who you actually want in on your fitness journey."

### Words to use
- Show up / showing up
- Inner circle
- Together / together-ness
- Consistent / consistency
- Commit / commitment
- Proof / prove
- Circle, group, people

### Words to avoid
- Crush it / beast mode / grind
- Track / monitor / watch / surveillance
- Performance / metrics / PBs / stats (in brand contexts)
- Accountability (in a punishing sense — reframe as belief)
- Social media / followers / audience

### Heading style
- Sentence case for most headings
- ALL CAPS for the slogan only: **SHOW UP. TOGETHER.**
- Contractions are fine and preferred ("isn't," "don't," "you're")
- Em dashes for punchy breaks: "Motivation fades. Your people don't."

---

## 3. Color Palette

All hex values are sourced directly from `theme.dart → LightModeColors`.

### Primary Brand Colors

| Role | Name | Hex | Usage |
|------|------|-----|-------|
| Primary | Huddle Medium | `#6F75FF` | Primary buttons, links, active states, progress indicators, logo dots |
| Primary Dark | Huddle Dark | `#292D91` | Secondary accent, gradient start, dark text on light containers |
| Primary Deepest | Brand Deep Blue | `#0A0F81` | CTAs on dark backgrounds, splash/onboarding hero buttons |
| Primary Light | Huddle Light | `#CFD1FF` | Button strokes, chip backgrounds, container backgrounds |

### Gradient
The brand gradient runs **dark to medium** — always left-to-right or top-to-bottom:
```css
background: linear-gradient(135deg, #292D91, #6F75FF);
```
Used on progress rings, highlight elements, and hero accents.

### Surface & Background Colors

| Role | Hex | Notes |
|------|-----|-------|
| Page scaffold | `#F7F8FA` | Very slightly off-white; softens shadows |
| Card / surface | `#FFFFFF` | Cards sit on top of scaffold |
| App bar / nav | `#FFFFFF` | Full white |
| Nav bar glass | `rgba(255,255,255,0.65)` | Frosted glass effect on floating nav |

### Text Colors

| Role | Hex | Notes |
|------|-----|-------|
| Primary text | `#1C1C1C` | Default body text on surfaces |
| Strong body | `#111111` | Emphasis text, onboarding copy |
| Secondary text | `#787878` | Captions, metadata |
| On primary | `#FFFFFF` | Text/icons on brand-colored fills |
| Comment / accent text | `#292D91` | Links and inline accents |

### Semantic Colors

| Role | Hex | Stroke | Notes |
|------|-----|--------|-------|
| Error / Destructive | `#F25D76` | `#FFCCD4` | Delete actions, error states |
| Error container | `#FFCCD4` | — | Destructive button stroke, light error bg |

### Dividers & Utility

| Role | Hex |
|------|-----|
| Divider | `#E0E0E0` |
| Feed section separator | `#E5E5E5` |
| Incomplete task card bg | `#F3F3F3` |
| Completed card halo | `#E6E7FF` |
| Add media border | `#BABABA` |

### CSS Custom Properties (use these in all web code)
```css
:root {
  /* Brand */
  --color-primary: #6F75FF;
  --color-primary-dark: #292D91;
  --color-primary-deep: #0A0F81;
  --color-primary-light: #CFD1FF;

  /* Gradient */
  --gradient-brand: linear-gradient(135deg, #292D91, #6F75FF);

  /* Surfaces */
  --color-scaffold: #F7F8FA;
  --color-surface: #FFFFFF;
  --color-nav-glass: rgba(255, 255, 255, 0.65);

  /* Text */
  --color-text-primary: #1C1C1C;
  --color-text-strong: #111111;
  --color-text-secondary: #787878;
  --color-text-on-brand: #FFFFFF;
  --color-text-accent: #292D91;

  /* Semantic */
  --color-destructive: #F25D76;
  --color-destructive-stroke: #FFCCD4;

  /* Utility */
  --color-divider: #E0E0E0;
  --color-card-halo: #E6E7FF;
}
```

---

## 4. Typography

**Typeface:** [Inter](https://fonts.google.com/specimen/Inter) — used exclusively throughout the app.

```html
<!-- Google Fonts import -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
```

```css
font-family: 'Inter', sans-serif;
```

### Type Scale (sourced from `FontSizes` class in `theme.dart`)

| Role | Size | Weight | Use case |
|------|------|--------|----------|
| Display Large | 57px | 400 | Hero / billboard (rare) |
| Display Medium | 45px | 400 | Hero headlines |
| Display Small | 36px | 600 | Section heroes |
| Headline Large | 32px | 400 | Page titles |
| Headline Medium | 24px | 500 | Section headings |
| Headline Small | 22px | 700 (bold) | Card headings, CTAs |
| Title Large | 22px | 500 | — |
| Title Medium | 18px | 500 | Subheadings |
| Title Small | 16px | 500 | Labels, nav items |
| Label Large | 16px | 500 | Button labels |
| Label Medium | 14px | 500 | Chips, secondary labels |
| Label Small | 12px | 500 | Metadata, captions |
| Body Large | 16px | 400 | Long-form body copy |
| Body Medium | 14px | 400 | Standard body |
| Body Small | 12px | 400 | Fine print, timestamps |

### Button text
- Weight: `700` (bold)
- Size: 14px (`bodyMedium`)

### CSS Typography Tokens
```css
:root {
  --font-family: 'Inter', sans-serif;

  --text-display-lg: 57px;
  --text-display-md: 45px;
  --text-display-sm: 36px;
  --text-headline-lg: 32px;
  --text-headline-md: 24px;
  --text-headline-sm: 22px;
  --text-title-md: 18px;
  --text-title-sm: 16px;
  --text-label-lg: 16px;
  --text-label-md: 14px;
  --text-label-sm: 12px;
  --text-body-lg: 16px;
  --text-body-md: 14px;
  --text-body-sm: 12px;
}
```

---

## 5. Spacing & Layout

**Base grid:** 8pt  
All spacing values should be multiples of 8 (8, 16, 24, 32, 40, 48...).

### Layout tokens

| Token | Value | Source |
|-------|-------|--------|
| Card horizontal padding | 16px | 8pt grid |
| Section padding | 24px | 8pt grid |
| Content max-width | 440px | Mobile-first; mirrors phone viewport |
| Nav bar content height | 56px | `LayoutTokens.navBarContentHeight` |

### Web-specific layout guidance
- **Mobile-first.** The app is portrait-locked iOS/Android. The website should feel native on mobile, then gracefully expand for desktop.
- On desktop, constrain the hero content to ~600px wide, centered, with generous negative space.
- Never exceed a content column of ~800px for text-heavy sections.

---

## 6. Border Radius

All sourced from the app's card/button/sheet conventions:

| Element | Radius | Source |
|---------|--------|--------|
| Cards | 16px | `cardTheme.shape` in `lightTheme` |
| Chips | 12px | `chipTheme.shape` |
| Bottom sheets (top edge) | 28px | `HuddleSheetTokens.topCornerRadius` |
| Buttons (medium, 54px height) | 13.5px ≈ **14px** | `height × 0.25` |
| Buttons (large, 60px height) | 15px | `height × 0.25` |
| Pill / full circle | 999px | `HuddleSheetTokens.handleBorderRadius` |

```css
:root {
  --radius-card: 16px;
  --radius-chip: 12px;
  --radius-sheet: 28px;
  --radius-button-md: 14px;   /* 54px button */
  --radius-button-lg: 15px;   /* 60px button */
  --radius-pill: 999px;
}
```

---

## 7. Buttons

### Button anatomy
All Huddle buttons share:
- **Zero elevation** (no box-shadow blur for the fill; shadow is on the card, not the button itself)
- **3.5px outer stroke** — this is the Huddle button signature. Every primary button has a thicker border that creates visual weight.
- `border-radius: height × 0.25`
- No hover/press ripple (mobile-first; use subtle opacity shift instead)

### Button variants

#### Primary (default)
```css
.btn-primary {
  height: 54px;
  background: #6F75FF;
  color: #FFFFFF;
  border: 3.5px solid #CFD1FF;
  border-radius: 14px;
  font-size: 14px;
  font-weight: 700;
  padding: 0 20px;
}
.btn-primary:hover {
  opacity: 0.92;
}
```

#### Brand Deep (onboarding / splash CTAs)
```css
.btn-brand-deep {
  height: 54px;
  background: #0A0F81;
  color: #FFFFFF;
  border: 3.5px solid #6F75FF;
  border-radius: 14px;
  font-size: 14px;
  font-weight: 700;
  padding: 0 28px;
}
```

#### Outlined
```css
.btn-outlined {
  height: 54px;
  background: transparent;
  color: #6F75FF;
  border: 1.2px solid #6F75FF;
  border-radius: 14px;
  font-size: 14px;
  font-weight: 700;
  padding: 0 20px;
}
```

#### Destructive
```css
.btn-destructive {
  height: 54px;
  background: #F25D76;
  color: #FFFFFF;
  border: 3.5px solid #FFCCD4;
  border-radius: 14px;
  font-size: 14px;
  font-weight: 700;
}
```

#### Large variant (all button types)
- Height: 60px → border-radius: 15px

---

## 8. Shadows

Two-layer shadow system for depth without harshness. Sourced from `AppShadows` in `theme.dart`.

### Card shadow (iOS-style)
```css
box-shadow:
  0px 8px 24px rgba(0, 0, 0, 0.08),   /* ambient */
  0px 1px 6px rgba(0, 0, 0, 0.04);    /* key */
```

### Task card shadow (slightly tighter)
```css
box-shadow:
  0px 2px 4px rgba(0, 0, 0, 0.10),    /* presence */
  0px 8px 20px -6px rgba(0, 0, 0, 0.04); /* ambient falloff */
```

---

## 9. Logo

The Huddle logo consists of two parts:
1. **Wordmark** — the text "Huddle" in a custom SVG letterform
2. **Four dots** — arranged in a diamond formation (top, right, bottom, left), each colored `#6F75FF`

### Logo behavior
- The dots are **animated** in the app (pulse + liftoff sequence). On the web, use the static form or a subtle CSS pulse.
- The dots sit at precise positions derived from the SVG viewBox `1704 × 678`:
  - Top dot center: `(327, 159.7)`
  - Right dot center: `(508.3, 341)`
  - Bottom dot center: `(327, 522.3)`
  - Left dot center: `(145.7, 341)`
  - Dot radius: `90.7` (in SVG units)
- Scale to any size by multiplying by `displayWidth / 1704`

### Logo on web
- Use the SVG asset if available: `Huddle-Logo2.svg` (full logo) or `Huddle-Logo2-text.svg` (wordmark only, overlay dots separately)
- Minimum display width: 120px
- Always maintain the SVG aspect ratio `678:1704` ≈ `0.398`
- Splash/hero: white background, logo centered
- Nav bar: logo at ~110–130px wide, left-aligned

---

## 10. Iconography

- Use **rounded** icons throughout (matching iOS SF Symbols / Material rounded style)
- Avoid sharp-cornered icon sets
- Icon color on primary backgrounds: `#FFFFFF`
- Icon color on light backgrounds: `#6F75FF` (primary) or `#1C1C1C` (neutral)

---

## 11. Component Patterns

### Cards
```css
.card {
  background: #FFFFFF;
  border-radius: 16px;
  box-shadow: 0px 8px 24px rgba(0,0,0,0.08), 0px 1px 6px rgba(0,0,0,0.04);
  padding: 16px;
}
```

### Chips (filter / tag)
```css
.chip {
  background: #CFD1FF;
  color: #292D91;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 500;
  padding: 8px 12px;
}
.chip.selected {
  background: #6F75FF;
  color: #FFFFFF;
}
```

### Progress ring / gradient accent
Use the brand gradient on circular progress indicators:
```css
/* SVG stroke gradient: from #292D91 to #6F75FF */
```

### Floating nav bar
```css
.nav-bar {
  background: rgba(255, 255, 255, 0.65);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-radius: 28px 28px 0 0; /* top corners only */
}
```

---

## 12. Animation Principles

Sourced from the app's animation philosophy:

- **Ease out cubic** is the default curve: things arrive fast, settle gently.
- **No bounce** — Huddle motion is confident, not playful-bouncy.
- **Stagger** group elements (e.g., the 4 dots animate with 120–200ms offsets, not simultaneously).
- **Short durations**: UI transitions 300–400ms; logo intro 480ms; liftoff sequence 2000ms (exceptional case).
- **No hover ripples** — use `opacity: 0.92` on hover for buttons, not flash effects.
- **Micro-animations** should be subtle (scale 0.985→1.0 on fade-in, not dramatic).

---

## 13. Photography & Visual Style

When selecting imagery for the website:

- **Real, in-the-moment photography** — not stock fitness models in studios. Show real people in real places: a park run, a backyard workout, a gym selfie.
- **Proof-photo aesthetic**: slightly imperfect, authentic, shot on phone. The "proof" format is the core UX.
- **Group over individual** — pairs and small groups > solo shots where possible.
- **Warm and candid** > glossy and aspirational.
- Avoid: extreme close-ups of muscles, competition imagery, protein shake culture.

---

## 14. App Store Information (for web copy)

- **App name:** Huddle
- **Category:** Health & Fitness
- **Platforms:** iOS (primary) and Android
- **Core feature:** Inner circles of up to 12 people
- **Key actions:** Commit → Prove (photo) → Celebrate
- **Premium tier (Huddle Pro):** ~$2.99/month — full proof history, grid archive, widgets, video proofs
- **Early adopters:** Users before the Pro launch date get **lifetime free Pro**

---

## 15. Domain & Technical

- **Primary domain:** `joinhuddle.fit`
- **Hosting:** GitHub Pages
- **Stack:** Static HTML/CSS/JS (or lightweight framework)
- **Analytics:** TBD
- **Email:** `dylan@joinhuddle.fit` (Google Workspace)

---

## Quick Reference Card

| Property | Value |
|----------|-------|
| Font | Inter |
| Primary color | `#6F75FF` |
| Primary dark | `#292D91` |
| Primary deep | `#0A0F81` |
| Primary light | `#CFD1FF` |
| Scaffold bg | `#F7F8FA` |
| Card bg | `#FFFFFF` |
| Primary text | `#1C1C1C` |
| Secondary text | `#787878` |
| Gradient | `#292D91` → `#6F75FF` |
| Card radius | 16px |
| Button radius | `height × 0.25` |
| Button stroke | 3.5px |
| Button height (md) | 54px |
| Button height (lg) | 60px |
| Spacing grid | 8pt |
| Card shadow | `0 8px 24px rgba(0,0,0,0.08)` |
| Slogan | SHOW UP. TOGETHER. |
