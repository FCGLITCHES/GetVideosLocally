const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  compareReleaseVersions,
  fetchLatestRelease,
  parseChecksumList,
  prepareYtDlpUpdate,
  swapInStagedBinary,
} = require("../backend/services/ytdlp-updater");

const sha = (text) => crypto.createHash("sha256").update(text).digest("hex");
const release = {
  version: "2026.11.02",
  assetName: "yt-dlp.exe",
  assetUrl: "https://example.test/yt-dlp.exe",
  sumsUrl: "https://example.test/SHA2-256SUMS",
};

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gvl-ytdlp-"));
  const executable = path.join(dir, "yt-dlp.exe");
  fs.writeFileSync(executable, "old-binary");
  return { dir, executable };
}

function fakeDownloader(files) {
  return async (url, destination) => {
    if (!(url in files)) throw new Error(`unexpected ${url}`);
    fs.writeFileSync(destination, files[url]);
  };
}

// The fake binary "reports" whatever version is written inside it.
const versionFromContents = async (file) => {
  const match = fs.readFileSync(file, "utf8").match(/v(\d{4}\.\d{2}\.\d{2})/);
  return match ? match[1] : null;
};

test("release metadata picks the platform asset and checksum list", async () => {
  const info = await fetchLatestRelease({
    platform: "win32",
    getJson: async () => ({
      tag_name: "2026.11.02",
      assets: [
        { name: "yt-dlp", browser_download_url: "https://x/yt-dlp" },
        { name: "yt-dlp.exe", browser_download_url: "https://x/yt-dlp.exe" },
        { name: "SHA2-256SUMS", browser_download_url: "https://x/SHA2-256SUMS" },
      ],
    }),
  });
  assert.equal(info.version, "2026.11.02");
  assert.equal(info.assetUrl, "https://x/yt-dlp.exe");
  await assert.rejects(
    fetchLatestRelease({ getJson: async () => ({ tag_name: "nightly", assets: [] }) }),
    /Unexpected yt-dlp release tag/,
  );
});

test("checksum list parsing and version ordering", () => {
  const list = `${"a".repeat(64)}  yt-dlp\n${"b".repeat(64)}  yt-dlp.exe\n`;
  assert.equal(parseChecksumList(list, "yt-dlp.exe"), "b".repeat(64));
  assert.equal(parseChecksumList(list, "yt-dlp_macos"), null);
  assert.equal(compareReleaseVersions("2026.10.21", "2026.11.02"), -1);
  assert.equal(compareReleaseVersions("2026.10.21.1", "2026.10.21"), 1);
  assert.equal(compareReleaseVersions("2026.10.21", "2026.10.21"), 0);
});

test("an up-to-date binary downloads nothing", async () => {
  const { dir, executable } = fixture();
  try {
    const result = await prepareYtDlpUpdate({
      executable,
      currentVersion: "yt-dlp 2026.11.02",
      getRelease: async () => release,
      downloader: async () => { throw new Error("must not download"); },
    });
    assert.equal(result.upToDate, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a verified release is staged beside the live binary without touching it", async () => {
  const { dir, executable } = fixture();
  const binary = "new-binary v2026.11.02";
  try {
    const result = await prepareYtDlpUpdate({
      executable,
      currentVersion: "2026.10.21",
      getRelease: async () => release,
      downloader: fakeDownloader({
        [release.sumsUrl]: `${sha(binary)}  yt-dlp.exe\n`,
        [release.assetUrl]: binary,
      }),
      versionOf: versionFromContents,
      logger: {},
    });
    assert.equal(result.upToDate, false);
    assert.equal(fs.readFileSync(executable, "utf8"), "old-binary");
    assert.equal(fs.readFileSync(result.stagedPath, "utf8"), binary);
    assert.equal(fs.existsSync(`${executable}.sha256sums`), false);

    const installed = await swapInStagedBinary({
      executable,
      stagedPath: result.stagedPath,
      expectedVersion: result.version,
      versionOf: versionFromContents,
    });
    assert.equal(installed, "2026.11.02");
    assert.equal(fs.readFileSync(executable, "utf8"), binary);
    assert.deepEqual(fs.readdirSync(dir), ["yt-dlp.exe"], "no staging or backup files left");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a tampered download is rejected and removed", async () => {
  const { dir, executable } = fixture();
  try {
    await assert.rejects(
      prepareYtDlpUpdate({
        executable,
        currentVersion: "2026.10.21",
        getRelease: async () => release,
        downloader: fakeDownloader({
          [release.sumsUrl]: `${sha("genuine")}  yt-dlp.exe\n`,
          [release.assetUrl]: "tampered v2026.11.02",
        }),
        versionOf: versionFromContents,
        logger: {},
      }),
      /Checksum mismatch/,
    );
    assert.deepEqual(fs.readdirSync(dir), ["yt-dlp.exe"]);
    assert.equal(fs.readFileSync(executable, "utf8"), "old-binary");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a new binary that fails its self-test is rolled back", async () => {
  const { dir, executable } = fixture();
  const staged = `${executable}.new`;
  fs.writeFileSync(staged, "broken");
  try {
    await assert.rejects(
      swapInStagedBinary({
        executable,
        stagedPath: staged,
        expectedVersion: "2026.11.02",
        versionOf: versionFromContents,
      }),
      /rolled back/,
    );
    assert.equal(fs.readFileSync(executable, "utf8"), "old-binary");
    assert.deepEqual(fs.readdirSync(dir), ["yt-dlp.exe"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
