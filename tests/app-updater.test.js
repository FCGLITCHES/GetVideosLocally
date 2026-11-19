const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("fs");
const path = require("path");

const {
  createAppUpdater,
  compareVersions,
  RELEASES_PAGE_URL,
} = require("../backend/services/app-updater");

const quietLogger = { warn() {}, info() {} };
const tick = () => new Promise((resolve) => setImmediate(resolve));

function fakeAutoUpdater({ onCheck } = {}) {
  const updater = new EventEmitter();
  updater.installCalls = [];
  updater.checkForUpdates = async () => {
    updater.emit("checking-for-update");
    if (onCheck) await onCheck(updater);
  };
  updater.quitAndInstall = (...args) => updater.installCalls.push(args);
  return updater;
}

test("compareVersions orders release numbers", () => {
  assert.equal(compareVersions("3.2.12", "3.2.11"), 1);
  assert.equal(compareVersions("v3.2.11", "3.2.11"), 0);
  assert.equal(compareVersions("3.2.9", "3.2.10"), -1);
  assert.equal(compareVersions("3.3", "3.2.99"), 1);
  assert.equal(compareVersions("", "3.2.11"), -1);
});

test("installed copies download in the background and install only when ready", async () => {
  const statuses = [];
  const updater = fakeAutoUpdater({
    onCheck: async (u) => {
      u.emit("update-available", { version: "3.2.13" });
      u.emit("download-progress", { percent: 41.6 });
    },
  });
  const app = createAppUpdater({
    currentVersion: "3.2.12",
    canSelfUpdate: true,
    getAutoUpdater: () => updater,
    getActiveDownloadCount: () => 0,
    onStatus: (s) => statuses.push(s.status),
    logger: quietLogger,
  });

  const state = await app.check();
  assert.equal(state.status, "downloading");
  assert.equal(state.progress, 42);
  assert.equal(updater.autoDownload, true);
  assert.equal(updater.autoInstallOnAppQuit, true);
  assert.deepEqual(await app.install(), { ok: false, reason: "not-ready" });

  updater.emit("update-downloaded", { version: "3.2.13" });
  assert.equal(app.getState().status, "ready");
  assert.equal(app.getState().latestVersion, "3.2.13");
  // A check while an update waits does not throw it away.
  assert.equal((await app.check()).status, "ready");
  assert.ok(statuses.includes("checking"));
});

test("restart to update waits for downloads and saves before installing", async () => {
  let active = 2;
  const order = [];
  const updater = fakeAutoUpdater();
  updater.quitAndInstall = (...args) => order.push(["install", ...args]);
  const app = createAppUpdater({
    currentVersion: "3.2.12",
    canSelfUpdate: true,
    getAutoUpdater: () => updater,
    getActiveDownloadCount: () => active,
    prepareForInstall: async () => {
      await tick();
      order.push(["prepare"]);
    },
    logger: quietLogger,
  });
  await app.check();
  updater.emit("update-downloaded", { version: "3.2.13" });

  assert.deepEqual(await app.install(), { ok: false, reason: "downloads-active" });
  await tick();
  assert.deepEqual(order, []);

  active = 0;
  assert.deepEqual(await app.install(), { ok: true });
  assert.deepEqual(await app.install(), { ok: true });
  for (let i = 0; i < 5; i++) await tick();
  // Saved first, installed once, silently, and the app reopens.
  assert.deepEqual(order, [["prepare"], ["install", true, true]]);
});

test("a failed later check keeps a finished update installable", async () => {
  const updater = fakeAutoUpdater();
  const app = createAppUpdater({
    currentVersion: "3.2.12",
    canSelfUpdate: true,
    getAutoUpdater: () => updater,
    getActiveDownloadCount: () => 0,
    logger: quietLogger,
  });
  await app.check();
  updater.emit("update-downloaded", { version: "3.2.13" });
  updater.emit("error", new Error("offline"));
  assert.equal(app.getState().status, "ready");
});

test("portable copies point to the download page when a newer release exists", async () => {
  const calls = [];
  const release = (tag) => async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ tag_name: tag }) };
  };
  const make = (fetchImpl) =>
    createAppUpdater({
      currentVersion: "3.2.12",
      canSelfUpdate: false,
      getAutoUpdater: () => {
        throw new Error("portable copies never load electron-updater");
      },
      getActiveDownloadCount: () => 0,
      fetchImpl,
      logger: quietLogger,
    });

  const newer = await make(release("v3.2.13")).check();
  assert.equal(newer.status, "available-manual");
  assert.equal(newer.latestVersion, "3.2.13");
  assert.equal(newer.downloadUrl, RELEASES_PAGE_URL);
  assert.match(calls[0].url, /api\.github\.com\/repos\/FCGLITCHES\/GetVideosLocally\/releases\/latest$/);

  assert.equal((await make(release("v3.2.12")).check()).status, "up-to-date");

  const offline = await make(async () => ({ ok: false, status: 503 })).check();
  assert.equal(offline.status, "error");
  assert.match(offline.error, /Try again later/);

  const portable = make(release("v3.2.13"));
  await portable.check();
  assert.deepEqual(await portable.install(), { ok: false, reason: "not-ready" });
});

test("release config publishes the files the in-app updater needs", () => {
  const builder = require("../electron-builder.json");
  const manifest = require("../package.json");
  assert.deepEqual(builder.publish, [
    { provider: "github", owner: "FCGLITCHES", repo: "GetVideosLocally", releaseType: "release" },
  ]);
  // latest.yml names this file, so the uploaded asset must keep the name.
  assert.equal(builder.nsis.artifactName, "GetVideosLocally.Setup.${version}.${ext}");
  assert.match(manifest.scripts["build:installer"], /--publish never$/);
  assert.ok(manifest.dependencies["electron-updater"]);
});

test("the app wires updates, settings backup and the About page", () => {
  const root = path.join(__dirname, "..");
  const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
  const main = read("electron-main.js");
  const preload = read("preload.js");
  const renderer = read("script.js");
  const html = read("index.html");
  const server = read("server.js");

  // Only installed copies (which ship app-update.yml) replace themselves.
  assert.match(main, /fs\.existsSync\(path\.join\(process\.resourcesPath, 'app-update\.yml'\)\)/);
  assert.match(main, /prepareForInstall: async \(\) => \{[^}]*flushRendererStorage\(\);[^}]*await shutdownBackendServer\(\);/);
  for (const name of [
    "readSettingsBackup",
    "writeSettingsBackup",
    "getAppInfo",
    "checkForAppUpdate",
    "getAppUpdateState",
    "installAppUpdate",
    "onAppUpdateStatus",
  ]) {
    assert.match(preload, new RegExp(`\\b${name}\\b`), `preload exposes ${name}`);
  }
  assert.match(renderer, /autoCheckUpdates: true/);
  assert.match(renderer, /function scheduleAppUpdateChecks\(/);
  for (const id of [
    "settingsTab-about",
    "settingsPanel-about",
    "aboutVersion",
    "checkAppUpdateBtn",
    "autoCheckUpdates",
    "aboutReportProblemBtn",
    "appUpdateBtn",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), `index.html has #${id}`);
  }
  // The page shows the running version, not a hard-coded one.
  assert.match(server, /data-app-version="\$\{version\}"/);
});
