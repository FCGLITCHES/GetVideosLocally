# GetVideosLocally — Product Demo 5

**Render target:** 1920×1080, 30fps, 35.5s (1065 frames), H.264.

## Product promise

Paste a video link, choose the output you want, and save the best available version locally — without subscriptions, quality caps, or streaming-only lock-in.

This demo follows the supplied 8-beat structural blueprint, adapted entirely to GetVideosLocally’s own copy, palette, and screenshots. No third-party branding or proprietary UI is reproduced.

---

## Scene 1 — Intro title sequence

| Field | Value |
|---|---|
| **Frames** | 0–119 (4.0s) |
| **Story job** | Opening hook, brand signoff |
| **Assets** | `logo.png`, Manrope + DM Serif Display fonts |
| **Background** | `#f6f7f9` → champagne-to-ruby gradient |

**On-screen copy**

- “Online video should not mean”
- “paywalls, caps, and compromise.”
- “GetVideosLocally”
- “Paste a link. Choose the quality. Keep the file.”

**Motion**

- Lines 1–2 fade in on light paper (frames 8–42).
- Background crossfades to `linear-gradient(135deg, #f7e7ce → #9b111e)` (frames 58–82).
- Logo + wordmark spring in centrally (frames 72+).
- Scene fades out (frames 106–118).

**Transition:** Hard dissolve into phone beat; contrast shifts from promise → tension.

**Implementation:** `src/scenes/IntroTitle.tsx`

---

## Scene 2 — Link trending on phone

| Field | Value |
|---|---|
| **Frames** | 120–224 (3.5s) |
| **Story job** | Interface demo (problem context) |
| **Assets** | Original phone frame (no Twitter/social clone) |

**On-screen copy**

- Headline: “A link goes viral. You still cannot keep it.”
- Notification: “NEW LINK SHARED — 8K HDR demo is everywhere”
- Cards: `#8KDemo`, `#HDR`, `#LocalFirst` with original titles

**Motion**

- Phone rises with spring (0–20f).
- Notification pops over feed (28f+).
- Feed scrolls −48px (52–90f).
- Fade out (93–103f).

**Camera:** Static centered phone; no decorative parallax.

**Implementation:** `src/scenes/LinkTrendingPhone.tsx`

---

## Scene 3 — Paywall montage

| Field | Value |
|---|---|
| **Frames** | 225–344 (4.0s) |
| **Story job** | Interface demo (friction stack) |
| **Assets** | Motion-graphics cards only — no social UI clones |

**On-screen copy (28f cuts)**

1. “Premium required” — Download unavailable on your plan
2. “Quality capped” — 1080p max unless you upgrade
3. “Sign in to continue” — Your session expired mid-watch
4. “Offline blocked” — Streaming only — no local file

**Motion**

- Quick cuts every 28 frames; scale 1.06→1.0 on enter; opacity pulse per card.
- Progress dots at bottom track active card.

**Transition:** Cut to cyclical diagram on light background.

**Implementation:** `src/scenes/PaywallMontage.tsx`

---

## Scene 4 — Subscription cycle

| Field | Value |
|---|---|
| **Frames** | 345–479 (4.5s) |
| **Story job** | How it works (problem loop) |
| **Assets** | Animated circles + emoji icons |

**On-screen copy**

- “Platforms apologize. Viewers still cannot keep the file.”
- Cycle nodes: Subscribe → Stream only → Lose access → Pay again
- Center: “The loop repeats”

**Motion**

- Background cycles through paper / blush / grey / champagne (45f phases).
- Four pill nodes orbit center; each pulses on staggered 24f intervals.
- Container rotates subtly (0→360° over scene, ×0.08).

**Implementation:** `src/scenes/SubscriptionCycle.tsx`

---

## Scene 5 — Logo reveal

| Field | Value |
|---|---|
| **Frames** | 480–569 (3.0s) |
| **Story job** | Brand signoff, product reveal |
| **Assets** | `logo.png` |

**On-screen copy**

- “GetVideosLocally”
- “Paste a link. Choose the quality. Keep the file.”

**Motion**

- Expanding ring behind mark (0–40f).
- Logo spring + slight rotate settle.
- Wordmark and tagline stagger +14f / +28f.
- White background throughout.

**Transition:** Cut to product UI (Pic2).

**Implementation:** `src/scenes/LogoReveal.tsx`

---

## Scene 6 — Platform home screen

| Field | Value |
|---|---|
| **Frames** | 570–749 (6.0s) |
| **Story job** | Interface demo |
| **Assets** | `Pic2.png` (1920×1080, dark empty-state) |

**Crop / focus**

- Frame: 1680×920, scale 1.0, focusY 48% — full dashboard with left input panel dominant.

**Authentic interaction geometry (Pic2)**

| Element | left | top | width | height |
|---|---:|---:|---:|---:|
| URL input | 118 | 292 | 612 | 46 |
| Download Now | 118 | 498 | 612 | 52 |

**On-screen copy**

- Heading: “One link. No account maze.”
- Typed URL: `https://www.youtube.com/watch?v=VuLeLs6TSIg`
- Caption: “Paste a video URL, pick quality, and download locally.”

**Motion**

- Screenshot rises (spring enter).
- Camera eases 1.03→1.0 (0–30f).
- Cursor: center → URL field → Download Now (0–148f).
- URL types over frames 38–108 (`TypedOverlay` on real field — no substitute input).
- `FieldHighlight` rings on real controls only.
- Clicks at 108f (field) and 148f (button).

**Implementation:** `src/scenes/HomeScreenDemo.tsx` — tune `URL_BOX` / `DOWNLOAD_BTN` if Pic2 layout changes.

---

## Scene 7 — Results animation

| Field | Value |
|---|---|
| **Frames** | 750–914 (5.5s) |
| **Story job** | Interface demo + outcome metrics |
| **Assets** | `Pic1.png` (active download, right-panel progress) |

**Crop / focus**

- Frame: 980×640, scale 1.22, focusX 62%, focusY 52% — download queue + progress bar.

**On-screen copy**

- Live progress overlay on real bar region: `3.8% → 100% at 136→412 Mbps`
- Gauge needle sweeps −55° → 48°
- Counter: 0 → 8 “files kept locally”
- “Better quality decisions, faster.”
- “From link to local file.”

**Motion**

- Progress numbers update over real screenshot crop (18–98f).
- Needle + counter animate in parallel.
- Benefit text fades up (88–108f).

**Note:** Progress percentage text is positioned at `(548, 248)` over Pic1’s native progress label area — adjust if Pic1 changes.

**Implementation:** `src/scenes/ResultsAnimation.tsx`

---

## Scene 8 — Call to action and outro

| Field | Value |
|---|---|
| **Frames** | 915–1064 (5.0s) |
| **Story job** | CTA, brand signoff |
| **Assets** | `Pic4.png`, `logo.png` |

**On-screen copy**

- “GetVideosLocally”
- “Paste a link. Choose the quality. Keep the file.”
- “Download free for Windows”
- “getvideoslocally.com”
- “Free • Open source • Windows”

**Motion**

- Pic4 history grid visible 0–28f, fades out.
- Champagne→ruby gradient fades in (18–42f).
- Logo, CTA button, URL spring sequentially (34f / 52f / 68f).
- Hold final frame for capture.

**Implementation:** `src/scenes/CallToAction.tsx`

---

## Asset map

| File | Use |
|---|---|
| `../remotion-demo/public/Pic1.png` | Active download / progress (Scene 7) |
| `../remotion-demo/public/Pic2.png` | Empty-state paste workflow (Scene 6) |
| `../remotion-demo/public/Pic3.png` | Reserved alternate history view |
| `../remotion-demo/public/Pic4.png` | History grid outro plate (Scene 8) |
| `../remotion-demo/public/logo.png` | Brand mark (Scenes 1, 5, 8) |
| `../remotion-demo/public/fonts/*` | Manrope + DM Serif Display |

Public directory is shared via `--public-dir ../remotion-demo/public` — screenshots are not duplicated.

---

## Timing table

| # | Scene | Start | Duration | Frames |
|---:|---|---:|---:|---:|
| 1 | Intro title | 0:00.0 | 4.0s | 120 |
| 2 | Phone trend | 0:04.0 | 3.5s | 105 |
| 3 | Paywall montage | 0:07.5 | 4.0s | 120 |
| 4 | Subscription cycle | 0:11.5 | 4.5s | 135 |
| 5 | Logo reveal | 0:16.0 | 3.0s | 90 |
| 6 | Home screen | 0:19.0 | 6.0s | 180 |
| 7 | Results | 0:25.0 | 5.5s | 165 |
| 8 | CTA / outro | 0:30.5 | 5.0s | 150 |
| | **Total** | | **35.5s** | **1065** |

---

## Commands

From `remotion (5)`:

```bash
npm install
npm run studio
npm run render
```

Studio opens composition **GetVideosLocallyDemo5**. Render outputs `out/GetVideosLocallyDemo5.mp4`.

---

## Coordinate tuning checklist

If screenshots update, re-verify in Remotion Studio:

1. **Scene 6** — cursor lands inside Pic2 URL field and Download Now button.
2. **Scene 7** — progress text sits over Pic1’s `% at Mbps` label; crop still shows chameleon thumbnail + bar.
3. **Scene 8** — Pic4 fade reads as “your library, kept locally” before brand CTA.

Never redraw inputs, buttons, or status panels — only highlight, type overlay, and crop authentic UI.
