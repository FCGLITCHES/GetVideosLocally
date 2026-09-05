#!/usr/bin/env node
/**
 * Collect every rendered demo video (and sidecar files in each out/) into demo-videos/.
 */
const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const COLLECT_DIR = path.join(REPO_ROOT, "demo-videos");

const { collateOutDir } = require("./collate-demo-video");

function findRemotionProjects() {
  const projects = [];
  for (const entry of fs.readdirSync(REPO_ROOT)) {
    if (!entry.startsWith("remotion")) {
      continue;
    }
    const projectPath = path.join(REPO_ROOT, entry);
    if (!fs.statSync(projectPath).isDirectory()) {
      continue;
    }
    const outDir = path.join(projectPath, "out");
    if (fs.existsSync(outDir) && fs.statSync(outDir).isDirectory()) {
      projects.push({ name: entry, outDir });
    }
  }
  return projects.sort((a, b) => a.name.localeCompare(b.name));
}

function main() {
  fs.mkdirSync(COLLECT_DIR, { recursive: true });
  const projects = findRemotionProjects();

  if (projects.length === 0) {
    console.log("No remotion*/out folders found.");
    return;
  }

  console.log(`Syncing to ${path.relative(REPO_ROOT, COLLECT_DIR)}/\n`);
  let total = 0;

  for (const { name, outDir } of projects) {
    console.log(`${name}:`);
    total += collateOutDir(name, outDir);
    console.log("");
  }

  console.log(`Synced ${total} file${total === 1 ? "" : "s"} total.`);
}

main();
