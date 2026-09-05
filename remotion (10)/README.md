# remotion (10)

Professional GetVideosLocally product demo package.

## Placement
Put this folder directly inside the root of your existing GetVideosLocally repository:

```text
GetVideosLocally/
├─ assets/
├─ public/
├─ remotion (10)/
│  ├─ src/
│  ├─ scripts/
│  ├─ package.json
│  └─ IMPLEMENTATION_PLAN.md
```

The project intentionally does **not** bundle or recreate product screenshots. `npm run studio` first copies the real source assets from the parent repo into this project's local `public/` directory.

## Open in Remotion Studio

```bash
cd "remotion (10)"
npm install
npm run studio
```

Then open the local Studio URL printed by Remotion and select composition **ProductDemo**.

## Render

```bash
npm run render
```

Output:
`out/ProductDemo.mp4`

## Creative intent
45 seconds, 1080p, 30fps. The story moves from product identity → paste link → choose format/quality → download → progress → capability breadth → history → proof → dark-field brand signoff.

Every interaction scene is composed around the authentic screenshot element at its actual geometry. The project refuses to fabricate a replacement UI state when the source asset is missing.
