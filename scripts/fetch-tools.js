#!/usr/bin/env node
"use strict";

// Fills bin/ with the pinned tool binaries from tools-manifest.json. Runs
// before every build so the binaries never have to live in git.
//
//   node scripts/fetch-tools.js          download anything missing or stale
//   node scripts/fetch-tools.js --check  only verify, exit 1 on a mismatch

const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");
const { computeSha256, downloadFile } = require("../backend/services/ffmpeg-update-security");

const projectRoot = path.join(__dirname, "..");

function loadManifest(manifestPath = path.join(projectRoot, "tools-manifest.json")) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const hash = /^[a-f0-9]{64}$/;
  for (const tool of manifest.tools || []) {
    if (!/^https:\/\//.test(tool.url) || !hash.test(tool.sha256) || !tool.files?.length) {
      throw new Error(`tools-manifest.json: ${tool.name} needs an https url, a sha256 and files`);
    }
    for (const file of tool.files) {
      if (!hash.test(file.sha256) || path.basename(file.name) !== file.name) {
        throw new Error(`tools-manifest.json: ${tool.name}/${file.name} has an invalid name or sha256`);
      }
    }
  }
  return manifest;
}

async function fileMatches(filePath, expected) {
  return fs.existsSync(filePath) && (await computeSha256(filePath)) === expected;
}

async function fetchTool(tool, { binDir, downloader = downloadFile, log = console.log }) {
  const pending = [];
  for (const file of tool.files) {
    if (!(await fileMatches(path.join(binDir, file.name), file.sha256))) pending.push(file);
  }
  if (!pending.length) {
    log(`  ok   ${tool.name} ${tool.version}`);
    return false;
  }

  // Work inside binDir so the final renames stay on one volume.
  const workDir = path.join(binDir, `.fetch-${tool.name.replace(/\W+/g, "")}-${process.pid}`);
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });
  try {
    log(`  get  ${tool.name} ${tool.version}  ${tool.url}`);
    const sourcePath = path.join(workDir, "source");
    await downloader(tool.url, sourcePath);
    const sourceHash = await computeSha256(sourcePath);
    if (sourceHash !== tool.sha256) {
      throw new Error(`${tool.name}: download sha256 ${sourceHash} does not match the manifest ${tool.sha256}`);
    }

    const zip = pending.some((file) => file.entry) ? new AdmZip(sourcePath) : null;
    for (const file of pending) {
      const stagedPath = path.join(workDir, file.name);
      if (file.entry) {
        const entry = zip.getEntry(file.entry);
        if (!entry) throw new Error(`${tool.name}: archive has no ${file.entry}`);
        fs.writeFileSync(stagedPath, entry.getData());
      } else {
        fs.copyFileSync(sourcePath, stagedPath);
      }
      const fileHash = await computeSha256(stagedPath);
      if (fileHash !== file.sha256) {
        throw new Error(`${tool.name}: ${file.name} sha256 ${fileHash} does not match the manifest ${file.sha256}`);
      }
    }
    for (const file of pending) {
      const target = path.join(binDir, file.name);
      fs.rmSync(target, { force: true });
      fs.renameSync(path.join(workDir, file.name), target);
    }
    return true;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

async function fetchTools({ binDir = path.join(projectRoot, "bin"), check = false, manifest = loadManifest(), downloader, log = console.log } = {}) {
  fs.mkdirSync(binDir, { recursive: true });
  const problems = [];
  for (const tool of manifest.tools) {
    if (check) {
      for (const file of tool.files) {
        const ok = await fileMatches(path.join(binDir, file.name), file.sha256);
        log(`  ${ok ? "ok  " : "BAD "} ${file.name} (${tool.name} ${tool.version})`);
        if (!ok) problems.push(file.name);
      }
    } else {
      await fetchTool(tool, { binDir, downloader, log });
    }
  }
  // A build packages everything in bin/, so stray files would ship too.
  const expected = new Set(manifest.tools.flatMap((tool) => tool.files.map((file) => file.name)));
  const extras = fs.readdirSync(binDir).filter((name) => !expected.has(name));
  if (extras.length) problems.push(...extras.map((name) => `unexpected bin/${name}`));
  return problems;
}

if (require.main === module) {
  const check = process.argv.includes("--check");
  console.log(check ? "Verifying bundled tools..." : "Fetching bundled tools...");
  fetchTools({ check })
    .then((problems) => {
      if (problems.length) {
        console.error(`Tool check failed: ${problems.join(", ")}`);
        process.exit(1);
      }
      console.log("Bundled tools are in place and verified.");
    })
    .catch((error) => {
      console.error(`Tool fetch failed: ${error.message}`);
      process.exit(1);
    });
}

module.exports = { fetchTool, fetchTools, loadManifest };
