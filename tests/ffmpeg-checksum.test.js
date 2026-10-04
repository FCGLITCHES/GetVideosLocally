const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const AdmZip = require("adm-zip");

const {
  computeSha256,
  downloadFile,
  installFfmpegFromZip,
} = require("../backend/services/ffmpeg-update-security");

test("FFmpeg download rejects insecure URLs and destination stream errors", async () => {
  const root = makeTempDir("gvl-ffmpeg-stream-");
  try {
    await assert.rejects(downloadFile("http://example.test/update.zip", path.join(root, "update.zip")), /HTTPS/);
    const https = require("https");
    const { EventEmitter } = require("events");
    const originalGet = https.get;
    https.get = () => {
      const request = new EventEmitter();
      request.destroy = () => {};
      request.setTimeout = () => {};
      return request;
    };
    try {
      await assert.rejects(downloadFile("https://example.test/update.zip", path.join(root, "missing", "update.zip")), { code: "ENOENT" });
    } finally { https.get = originalGet; }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("FFmpeg download follows relative HTTPS redirects and rejects a downgrade", async () => {
  const root = makeTempDir("gvl-ffmpeg-redirect-");
  const https = require("https");
  const { EventEmitter } = require("events");
  const { PassThrough } = require("stream");
  const originalGet = https.get;
  const visited = [];
  https.get = (url, callback) => {
    visited.push(url.href);
    const request = new EventEmitter(); request.destroy = () => {}; request.setTimeout = () => {};
    process.nextTick(() => {
      const response = new PassThrough();
      response.statusCode = 302;
      response.headers = { location: visited.length === 1 ? "/second.zip" : "http://example.test/unsafe.zip" };
      callback(response); response.end();
    });
    return request;
  };
  try {
    await assert.rejects(downloadFile("https://example.test/start.zip", path.join(root, "update.zip")), /HTTPS/);
    assert.deepEqual(visited, ["https://example.test/start.zip", "https://example.test/second.zip"]);
  } finally { https.get = originalGet; fs.rmSync(root, { recursive: true, force: true }); }
});

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeExistingBinaries(binDir) {
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, "ffmpeg.exe"), "old-ffmpeg");
  fs.writeFileSync(path.join(binDir, "ffprobe.exe"), "old-ffprobe");
}

function createFfmpegZip(zipPath, contentPrefix = "new") {
  const zip = new AdmZip();
  zip.addFile(
    "ffmpeg-9.9/bin/ffmpeg.exe",
    Buffer.from(`${contentPrefix}-ffmpeg`),
  );
  zip.addFile(
    "ffmpeg-9.9/bin/ffprobe.exe",
    Buffer.from(`${contentPrefix}-ffprobe`),
  );
  zip.addFile(
    "ffmpeg-9.9/bin/ffplay.exe",
    Buffer.from(`${contentPrefix}-ffplay`),
  );
  zip.writeZip(zipPath);
}

function silentLogger() {
  return { info() {}, warn() {}, error() {} };
}

test("a locked second binary rolls back the already-installed first binary", async () => {
  const tmpDir = makeTempDir("gvl-ffmpeg-second-lock-");
  const originalRename = fs.renameSync;
  try {
    const source = path.join(tmpDir, "source.zip"); const binDir = path.join(tmpDir, "bin");
    createFfmpegZip(source); writeExistingBinaries(binDir);
    const checksum = await computeSha256(source);
    fs.renameSync = (from, to) => {
      if (from.endsWith("ffprobe.exe") && to.endsWith(".bak")) throw Object.assign(new Error("locked"), { code: "EBUSY" });
      return originalRename(from, to);
    };
    const result = await installFfmpegFromZip({ version: "9.9", manifest: { "9.9": checksum }, binDir,
      testFFmpegWorking: async () => true, tmpDir: path.join(tmpDir, "install"), logger: silentLogger(),
      downloader: async (_, dest) => fs.copyFileSync(source, dest) });
    assert.equal(result.success, false);
    assert.equal(fs.readFileSync(path.join(binDir, "ffmpeg.exe"), "utf8"), "old-ffmpeg");
    assert.equal(fs.readFileSync(path.join(binDir, "ffprobe.exe"), "utf8"), "old-ffprobe");
  } finally { fs.renameSync = originalRename; fs.rmSync(tmpDir, { recursive: true, force: true }); }
});

test("incomplete trusted archives leave both installed binaries untouched", async () => {
  const tmpDir = makeTempDir("gvl-ffmpeg-incomplete-");
  try {
    const source = path.join(tmpDir, "source.zip"); const binDir = path.join(tmpDir, "bin");
    const zip = new AdmZip(); zip.addFile("ffmpeg/bin/ffmpeg.exe", Buffer.from("new")); zip.writeZip(source);
    writeExistingBinaries(binDir); const checksum = await computeSha256(source);
    const result = await installFfmpegFromZip({ version: "9.9", manifest: { "9.9": checksum }, binDir,
      testFFmpegWorking: async () => true, tmpDir: path.join(tmpDir, "install"), logger: silentLogger(),
      downloader: async (_, dest) => fs.copyFileSync(source, dest) });
    assert.equal(result.success, false); assert.match(result.error, /both FFmpeg and FFprobe/);
    assert.equal(fs.readFileSync(path.join(binDir, "ffmpeg.exe"), "utf8"), "old-ffmpeg");
  } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
});

test("matching SHA256 installs staged binaries and removes backups", async () => {
  const tmpDir = makeTempDir("gvl-ffmpeg-pass-");
  try {
    const sourceZip = path.join(tmpDir, "source.zip");
    const installTmp = path.join(tmpDir, "install");
    const binDir = path.join(tmpDir, "bin");
    createFfmpegZip(sourceZip);
    writeExistingBinaries(binDir);

    const checksum = await computeSha256(sourceZip);
    const result = await installFfmpegFromZip({
      downloadUrl: "https://example.test/ffmpeg.zip",
      version: "9.9",
      manifest: { 9.9: checksum },
      binDir,
      testFFmpegWorking: async () => true,
      tmpDir: installTmp,
      logger: silentLogger(),
      downloader: async (_, destinationPath) =>
        fs.copyFileSync(sourceZip, destinationPath),
    });

    assert.equal(result.success, true);
    assert.equal(
      fs.readFileSync(path.join(binDir, "ffmpeg.exe"), "utf8"),
      "new-ffmpeg",
    );
    assert.equal(fs.existsSync(path.join(binDir, "ffmpeg.exe.bak")), false);
    assert.equal(fs.existsSync(installTmp), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("mismatched SHA256 rejects and leaves current binaries untouched", async () => {
  const tmpDir = makeTempDir("gvl-ffmpeg-mismatch-");
  try {
    const sourceZip = path.join(tmpDir, "source.zip");
    const binDir = path.join(tmpDir, "bin");
    createFfmpegZip(sourceZip);
    writeExistingBinaries(binDir);

    const result = await installFfmpegFromZip({
      downloadUrl: "https://example.test/ffmpeg.zip",
      version: "9.9",
      manifest: { 9.9: "0".repeat(64) },
      binDir,
      testFFmpegWorking: async () => true,
      tmpDir: path.join(tmpDir, "install"),
      logger: silentLogger(),
      downloader: async (_, destinationPath) =>
        fs.copyFileSync(sourceZip, destinationPath),
    });

    assert.equal(result.success, false);
    assert.match(result.error, /Checksum verification failed/);
    assert.equal(
      fs.readFileSync(path.join(binDir, "ffmpeg.exe"), "utf8"),
      "old-ffmpeg",
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("version not in manifest aborts before download attempt", async () => {
  const tmpDir = makeTempDir("gvl-ffmpeg-untrusted-");
  try {
    const binDir = path.join(tmpDir, "bin");
    writeExistingBinaries(binDir);
    let downloadAttempted = false;

    const result = await installFfmpegFromZip({
      downloadUrl: "https://example.test/ffmpeg.zip",
      version: "10.0",
      manifest: { 9.9: "1".repeat(64) },
      binDir,
      testFFmpegWorking: async () => true,
      tmpDir: path.join(tmpDir, "install"),
      logger: silentLogger(),
      downloader: async () => {
        downloadAttempted = true;
      },
    });

    assert.equal(result.success, false);
    assert.equal(result.skippedBeforeDownload, true);
    assert.equal(downloadAttempted, false);
    assert.equal(
      fs.readFileSync(path.join(binDir, "ffmpeg.exe"), "utf8"),
      "old-ffmpeg",
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("download failure leaves current ffmpeg untouched", async () => {
  const tmpDir = makeTempDir("gvl-ffmpeg-download-fail-");
  try {
    const binDir = path.join(tmpDir, "bin");
    writeExistingBinaries(binDir);

    const result = await installFfmpegFromZip({
      downloadUrl: "https://example.test/ffmpeg.zip",
      version: "9.9",
      manifest: { 9.9: "1".repeat(64) },
      binDir,
      testFFmpegWorking: async () => true,
      tmpDir: path.join(tmpDir, "install"),
      logger: silentLogger(),
      downloader: async () => {
        throw new Error("network unavailable");
      },
    });

    assert.equal(result.success, false);
    assert.match(result.error, /network unavailable/);
    assert.equal(
      fs.readFileSync(path.join(binDir, "ffmpeg.exe"), "utf8"),
      "old-ffmpeg",
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("locked existing binary aborts cleanly and keeps current binary", async () => {
  const tmpDir = makeTempDir("gvl-ffmpeg-locked-");
  const originalRenameSync = fs.renameSync;
  try {
    const sourceZip = path.join(tmpDir, "source.zip");
    const binDir = path.join(tmpDir, "bin");
    createFfmpegZip(sourceZip);
    writeExistingBinaries(binDir);
    const checksum = await computeSha256(sourceZip);

    fs.renameSync = (from, to) => {
      if (from.endsWith("ffmpeg.exe") && to.endsWith("ffmpeg.exe.bak")) {
        const error = new Error("file is locked");
        error.code = "EBUSY";
        throw error;
      }
      return originalRenameSync(from, to);
    };

    const result = await installFfmpegFromZip({
      downloadUrl: "https://example.test/ffmpeg.zip",
      version: "9.9",
      manifest: { 9.9: checksum },
      binDir,
      testFFmpegWorking: async () => true,
      tmpDir: path.join(tmpDir, "install"),
      logger: silentLogger(),
      downloader: async (_, destinationPath) =>
        fs.copyFileSync(sourceZip, destinationPath),
    });

    assert.equal(result.success, false);
    assert.match(result.error, /ffmpeg\.exe is locked/);
    assert.equal(
      fs.readFileSync(path.join(binDir, "ffmpeg.exe"), "utf8"),
      "old-ffmpeg",
    );
  } finally {
    fs.renameSync = originalRenameSync;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("working check failure rolls back installed binaries", async () => {
  const tmpDir = makeTempDir("gvl-ffmpeg-rollback-");
  try {
    const sourceZip = path.join(tmpDir, "source.zip");
    const binDir = path.join(tmpDir, "bin");
    createFfmpegZip(sourceZip);
    writeExistingBinaries(binDir);
    const checksum = await computeSha256(sourceZip);

    const result = await installFfmpegFromZip({
      downloadUrl: "https://example.test/ffmpeg.zip",
      version: "9.9",
      manifest: { 9.9: checksum },
      binDir,
      testFFmpegWorking: async () => false,
      tmpDir: path.join(tmpDir, "install"),
      logger: silentLogger(),
      downloader: async (_, destinationPath) =>
        fs.copyFileSync(sourceZip, destinationPath),
    });

    assert.equal(result.success, false);
    assert.match(result.error, /rolled back/);
    assert.equal(
      fs.readFileSync(path.join(binDir, "ffmpeg.exe"), "utf8"),
      "old-ffmpeg",
    );
    assert.equal(
      fs.readFileSync(path.join(binDir, "ffprobe.exe"), "utf8"),
      "old-ffprobe",
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("mid-install move failure rolls back binaries already replaced", async () => {
  const tmpDir = makeTempDir("gvl-ffmpeg-mid-fail-");
  const originalRenameSync = fs.renameSync;
  try {
    const sourceZip = path.join(tmpDir, "source.zip");
    const binDir = path.join(tmpDir, "bin");
    createFfmpegZip(sourceZip);
    writeExistingBinaries(binDir);
    const checksum = await computeSha256(sourceZip);

    fs.renameSync = (from, to) => {
      if (from.endsWith("ffprobe.exe") && to.endsWith("ffprobe.exe")) {
        throw new Error("simulated move failure");
      }
      return originalRenameSync(from, to);
    };

    const result = await installFfmpegFromZip({
      downloadUrl: "https://example.test/ffmpeg.zip",
      version: "9.9",
      manifest: { 9.9: checksum },
      binDir,
      testFFmpegWorking: async () => true,
      tmpDir: path.join(tmpDir, "install"),
      logger: silentLogger(),
      downloader: async (_, destinationPath) =>
        fs.copyFileSync(sourceZip, destinationPath),
    });

    assert.equal(result.success, false);
    assert.match(result.error, /Failed to install ffprobe\.exe/);
    assert.equal(
      fs.readFileSync(path.join(binDir, "ffmpeg.exe"), "utf8"),
      "old-ffmpeg",
    );
    assert.equal(
      fs.readFileSync(path.join(binDir, "ffprobe.exe"), "utf8"),
      "old-ffprobe",
    );
  } finally {
    fs.renameSync = originalRenameSync;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
