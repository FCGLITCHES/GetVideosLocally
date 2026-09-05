# GetVideosLocally — Remotion (10) Production Plan

## Product promise
**Paste a link. Choose your quality. Keep the file.**

The demo is a 45-second, 1920×1080, 30fps product film built around the product's real interface. It uses the GetVideosLocally screenshots as geometric source plates and only adds editorial copy, camera movement, cursor motion, focus rings, and transition layers.

## Scene map

| Scene | Time | Frames | Purpose | Authentic source | Motion / implementation |
|---|---:|---:|---|---|---|
| 1. Product reveal | 0:00–0:03.5 | 0–104 | Opening hook | `assets/Logo.png` | White field; logo/title/subtitle arrive with one restrained spring. |
| 2. Paste URL | 0:03.5–0:09 | 105–269 | Primary task | `public/Pic2.png` | Full UI reframes toward the real URL field. Cursor travels to source rect `x35 y441 w505 h56`; a thin red focus ring appears in-place. |
| 3. Choose format + quality | 0:09–0:13.5 | 270–404 | Configuration | `public/Pic2.png` | Continuous camera move down the same real interface. Focus transfers from format rect `x36 y553 w244 h55` to quality rect `x295 y553 w242 h55`. |
| 4. Download action | 0:13.5–0:17.5 | 405–524 | Action / bridge | `public/Pic2.png` | Macro crop on authentic Download Now control `x35 y686 w505 h59`. Cursor click compresses; product red expands as a full-screen transition. |
| 5. Progress proof | 0:17.5–0:23.5 | 525–704 | Outcome in motion | `public/Pic1.png` | Red bridge reveals the captured download state. Camera settles on the real progress region `x615 y323 w624 h175`. |
| 6. Capability carousel | 0:23.5–0:29 | 705–869 | Breadth / flexibility | Editorial graphic only | Vertically clipped list: MP4 up to 8K, MKV/WEBM/MOV, MP3/WAV/FLAC, M4A/OPUS, 1000+ sites. No fake app controls. |
| 7. History / file handoff | 0:29–0:35 | 870–1049 | Continued utility | `public/Pic3.png` | Reframe to a genuine history card `x12 y358 w402 h185`; cursor approaches the existing folder action. |
| 8. Results-backed proof | 0:35–0:41 | 1050–1229 | Value proof | Product claims | Central claim with four settling proof tiles: 8K, 1000+, Free, Local. Tiles use varied offsets and subtle parallax. |
| 9. Brand signoff | 0:41–0:45 | 1230–1349 | Recognition / CTA | `assets/Logo.png` | Cut to black. Logo and product name resolve in the center. Final line: **Free. Local. Up to 8K.** |

## Visual system
- Canvas: 1920×1080, 30fps.
- Palette: product red `#c9152d`, ink `#151515`, warm paper `#f7f7f5`, black signoff `#090909`.
- Typeface: the repository's local Manrope WOFF2.
- Camera easing: `Easing.bezier(0.16, 1, 0.3, 1)`.
- Text hierarchy: 70–82px hero, 38px scene statement, 20–29px supporting copy.
- Cursor is intentionally sparse: one clear travel path per interaction scene.
- Focus rings are overlays only; they land on the real controls at their real screenshot coordinates.
- No recreated inputs, fake cards, fake download rows, or substitute application chrome.

## Asset requirements
The Studio pre-script copies these files from the parent GetVideosLocally repository:
- `public/Pic1.png`
- `public/Pic2.png`
- `public/Pic3.png`
- `public/Pic4.png`
- `assets/Logo.png`
- `public/fonts/manrope-latin.woff2`

`Pic4.png` is synced for future refinements even though the current cut does not need it.

## Implementation notes
Animations are frame-driven with `useCurrentFrame()`, `interpolate()`, `spring()`, and Remotion `Sequence`s. The screenshots remain immutable source plates. Camera math maps screenshot-space coordinates into the 1920×1080 composition so cursor, highlight, and crop positions stay geometrically consistent during zooms.

The final composition ID is `ProductDemo`. Duration is 1350 frames (45 seconds).
