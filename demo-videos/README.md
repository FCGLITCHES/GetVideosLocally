# Demo videos (collated)

Render scripts that invoke `collate-demo-video.js` copy their outputs here. Run the sync command below to collect outputs from every `remotion*` project.

- **Originals** stay in each project's `out/` folder.
- **Copies** land here as `{project-folder}__{filename}` (e.g. `remotion (6)__GetVideosLocallyDemo6.mp4`).

Re-sync everything:

```bash
npm run demo-videos:sync
```

Validation during consolidation: desktop tests passed (79); configured demo TypeScript checks passed. The batch collector reuses the same copy function as single-project collection. Media/sidecar selection, source preservation, repeat calls and missing directories were checked locally. Existing renders are retained locally; no new render or visual acceptance is implied. Runtime logs and generated release metadata are no longer tracked.
