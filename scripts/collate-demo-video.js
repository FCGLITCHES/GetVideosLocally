#!/usr/bin/env node
/**
 * Copy rendered demo assets from a Remotion project's out/ folder into demo-videos/.
 * Originals stay in place; this only adds collated copies.
 *
 * Usage (from a remotion project folder):
 *   node ../scripts/collate-demo-video.js out/GetVideosLocallyDemo6.mp4
 */
const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const COLLECT_DIR = path.join(REPO_ROOT, "demo-videos");

const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".mkv"]);
const SIDECAR_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".yml",
  ".json",
  ".txt",
]);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function shouldCopy(filename) {
  const ext = path.extname(filename).toLowerCase();
  return VIDEO_EXTENSIONS.has(ext) || SIDECAR_EXTENSIONS.has(ext);
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
  console.log(
    `  ${path.relative(REPO_ROOT, src)} -> ${path.relative(REPO_ROOT, dest)}`,
  );
}

function collateOutDir(projectName, outDir) {
  if (!fs.existsSync(outDir)) {
    console.warn(`Skip (no out/): ${path.relative(REPO_ROOT, outDir)}`);
    return 0;
  }

  let copied = 0;
  for (const entry of fs.readdirSync(outDir)) {
    const src = path.join(outDir, entry);
    if (!fs.statSync(src).isFile() || !shouldCopy(entry)) {
      continue;
    }
    const dest = path.join(COLLECT_DIR, `${projectName}__${entry}`);
    copyFile(src, dest);
    copied += 1;
  }
  return copied;
}

function collateFromCwd(videoRelPath) {
  const cwd = process.cwd();
  const projectName = path.basename(cwd);
  const videoAbs = path.resolve(cwd, videoRelPath);

  if (!fs.existsSync(videoAbs)) {
    console.error(`Video not found: ${videoAbs}`);
    process.exit(1);
  }

  ensureDir(COLLECT_DIR);
  console.log(`Collating from ${projectName}:`);
  const copied = collateOutDir(projectName, path.dirname(videoAbs));

  if (copied === 0) {
    console.warn("No files copied.");
    process.exit(1);
  }

  console.log(`Done (${copied} file${copied === 1 ? "" : "s"}).`);
}

module.exports = { collateOutDir };

if (require.main === module) {
  const videoArg = process.argv[2];
  if (!videoArg) {
    console.error(
      "Usage: node scripts/collate-demo-video.js <path-to-video-relative-to-cwd>",
    );
    process.exit(1);
  }
  collateFromCwd(videoArg);
}
