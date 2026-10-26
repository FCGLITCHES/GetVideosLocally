"use strict";

// Staged yt-dlp updates.
//
// `yt-dlp -U` rewrites its own executable in place, which crashes any other
// yt-dlp process still reading from it. Instead the new release is downloaded
// next to the current binary, verified against the release's SHA2-256SUMS and
// test-run while downloads carry on. Only the final rename waits for the tool
// update gate, so the window where downloads are paused is a few milliseconds.

const fs = require("fs");
const https = require("https");
const { spawn } = require("child_process");
const { computeSha256, downloadFile } = require("./ffmpeg-update-security");

const RELEASE_API_PATH = "/repos/yt-dlp/yt-dlp/releases/latest";

function assetNameForPlatform(platform = process.platform) {
  if (platform === "win32") return "yt-dlp.exe";
  if (platform === "darwin") return "yt-dlp_macos";
  return "yt-dlp_linux";
}

function fetchJson(hostname, requestPath, { timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      {
        hostname,
        path: requestPath,
        headers: {
          "User-Agent": "GetVideosLocally-App",
          Accept: "application/vnd.github+json",
        },
        timeout,
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error(`GitHub API returned HTTP ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(new Error(`Failed to parse GitHub API response: ${error.message}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("GitHub API request timed out"));
    });
  });
}

async function fetchLatestRelease({ platform = process.platform, getJson = fetchJson } = {}) {
  const release = await getJson("api.github.com", RELEASE_API_PATH);
  const tag = String(release?.tag_name || "").replace(/^v/, "");
  if (!/^\d{4}\.\d{2}\.\d{2}(\.\d+)?$/.test(tag)) {
    throw new Error(`Unexpected yt-dlp release tag: ${release?.tag_name}`);
  }
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const assetName = assetNameForPlatform(platform);
  const asset = assets.find((entry) => entry.name === assetName);
  const sums = assets.find((entry) => entry.name === "SHA2-256SUMS");
  if (!asset || !sums) {
    throw new Error(`yt-dlp ${tag} release is missing ${asset ? "SHA2-256SUMS" : assetName}`);
  }
  return {
    version: tag,
    assetName,
    assetUrl: asset.browser_download_url,
    sumsUrl: sums.browser_download_url,
  };
}

function parseChecksumList(text, fileName) {
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.trim().match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
    if (match && match[2].trim() === fileName) return match[1].toLowerCase();
  }
  return null;
}

// "2026.10.21" < "2026.10.21.1" < "2026.11.02"
function compareReleaseVersions(a, b) {
  const pa = String(a).split(".").map((part) => parseInt(part, 10) || 0);
  const pb = String(b).split(".").map((part) => parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff) return diff < 0 ? -1 : 1;
  }
  return 0;
}

function extractVersion(output) {
  const match = String(output || "").match(/\d{4}\.\d{2}\.\d{2}(?:\.\d+)?/);
  return match ? match[0] : null;
}

function readBinaryVersion(executable, { timeout = 30000 } = {}) {
  return new Promise((resolve) => {
    let output = "";
    let proc;
    try {
      proc = spawn(executable, ["--version"], {
        stdio: ["ignore", "pipe", "pipe"],
        timeout,
        windowsHide: true,
      });
    } catch {
      resolve(null);
      return;
    }
    proc.stdout.on("data", (chunk) => (output += chunk));
    proc.stderr.on("data", (chunk) => (output += chunk));
    proc.on("error", () => resolve(null));
    proc.on("close", (code) => resolve(code === 0 ? extractVersion(output) : null));
  });
}

function removeQuietly(filePath) {
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    // Best effort; a leftover staging file is replaced next time.
  }
}

// Download, verify and test-run the latest release without touching the live
// binary. Resolves with null when the current binary is already current.
async function prepareYtDlpUpdate({
  executable,
  currentVersion,
  platform = process.platform,
  getRelease = fetchLatestRelease,
  downloader = downloadFile,
  versionOf = readBinaryVersion,
  logger = console,
}) {
  const release = await getRelease({ platform });
  const current = extractVersion(currentVersion);
  if (current && compareReleaseVersions(current, release.version) >= 0) {
    return { upToDate: true, version: current, latestVersion: release.version };
  }

  const stagedPath = `${executable}.new`;
  const sumsPath = `${executable}.sha256sums`;
  removeQuietly(stagedPath);
  try {
    await downloader(release.sumsUrl, sumsPath);
    const expected = parseChecksumList(fs.readFileSync(sumsPath, "utf8"), release.assetName);
    if (!expected) {
      throw new Error(`SHA2-256SUMS has no entry for ${release.assetName}`);
    }

    logger.info?.(`📥 Downloading yt-dlp ${release.version} to a staging file...`);
    await downloader(release.assetUrl, stagedPath);
    const actual = await computeSha256(stagedPath);
    if (actual !== expected) {
      throw new Error(`Checksum mismatch for yt-dlp ${release.version} (expected ${expected}, got ${actual})`);
    }
    if (platform !== "win32") fs.chmodSync(stagedPath, 0o755);

    const stagedVersion = await versionOf(stagedPath);
    if (stagedVersion !== release.version) {
      throw new Error(`Staged yt-dlp reported version ${stagedVersion || "nothing"}, expected ${release.version}`);
    }
    return { upToDate: false, stagedPath, version: release.version, sha256: actual };
  } catch (error) {
    removeQuietly(stagedPath);
    throw error;
  } finally {
    removeQuietly(sumsPath);
  }
}

// Swap a verified staged binary into place. Must run while no tool process
// is alive (inside the update gate). Rolls back if the new binary fails.
async function swapInStagedBinary({ executable, stagedPath, expectedVersion, versionOf = readBinaryVersion }) {
  const backupPath = `${executable}.old`;
  removeQuietly(backupPath);
  const hadCurrent = fs.existsSync(executable);
  if (hadCurrent) fs.renameSync(executable, backupPath);
  try {
    fs.renameSync(stagedPath, executable);
  } catch (error) {
    if (hadCurrent) fs.renameSync(backupPath, executable);
    throw new Error(`Could not move the new yt-dlp into place: ${error.message}`);
  }

  const installedVersion = await versionOf(executable);
  if (installedVersion !== expectedVersion) {
    removeQuietly(executable);
    if (hadCurrent) fs.renameSync(backupPath, executable);
    throw new Error(`New yt-dlp failed its self-test (reported ${installedVersion || "nothing"}); rolled back`);
  }
  removeQuietly(backupPath);
  return installedVersion;
}

module.exports = {
  assetNameForPlatform,
  compareReleaseVersions,
  extractVersion,
  fetchLatestRelease,
  parseChecksumList,
  prepareYtDlpUpdate,
  readBinaryVersion,
  swapInStagedBinary,
};
