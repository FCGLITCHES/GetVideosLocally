"use strict";

const { tr } = require("../utils/ui-message");

// In-app updates for GetVideosLocally.
//
// Installed copies (NSIS) use electron-updater: the new version downloads in
// the background and installs on "Restart to update" (or the next time the app
// quits). The installer upgrades in place, and settings, history and
// downloads live in the user's AppData, so they carry over.
//
// Portable copies cannot replace themselves, so they only compare against the
// latest GitHub release and point the user to the download page.

const RELEASES_PAGE_URL = "https://getvideoslocally.com/#download";
const LATEST_RELEASE_API =
  "https://api.github.com/repos/FCGLITCHES/GetVideosLocally/releases/latest";

function compareVersions(a, b) {
  const pa = String(a || "").replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b || "").replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

function createAppUpdater({
  currentVersion,
  canSelfUpdate,
  getAutoUpdater,
  getActiveDownloadCount,
  prepareForInstall = async () => {},
  fetchImpl = globalThis.fetch,
  onStatus = () => {},
  logger = console,
}) {
  let state = {
    status: "idle", // idle | checking | up-to-date | downloading | ready | available-manual | error
    currentVersion,
    latestVersion: null,
    progress: 0,
    canSelfUpdate: Boolean(canSelfUpdate),
    downloadUrl: RELEASES_PAGE_URL,
    lastChecked: null,
    error: null,
  };
  let updater = null;
  let checking = null;

  function setState(patch) {
    state = { ...state, ...patch };
    try {
      onStatus({ ...state });
    } catch (error) {
      logger.warn?.("App update status listener failed:", error.message);
    }
  }

  function getUpdater() {
    if (updater || !state.canSelfUpdate) return updater;
    updater = getAutoUpdater();
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.allowPrerelease = false;
    updater.logger = null;
    updater.on("checking-for-update", () => setState({ status: "checking", error: null }));
    updater.on("update-not-available", () =>
      setState({ status: "up-to-date", latestVersion: currentVersion, lastChecked: Date.now() }),
    );
    updater.on("update-available", (info) =>
      setState({ status: "downloading", latestVersion: info?.version || null, progress: 0, lastChecked: Date.now() }),
    );
    updater.on("download-progress", (progress) =>
      setState({ status: "downloading", progress: Math.round(progress?.percent || 0) }),
    );
    updater.on("update-downloaded", (info) =>
      setState({ status: "ready", latestVersion: info?.version || state.latestVersion, progress: 100 }),
    );
    updater.on("error", (error) => {
      logger.warn?.("App update failed:", error?.message || error);
      // A finished download stays installable even if a later check fails.
      if (state.status !== "ready") setState({ status: "error", error: tr("Couldn't check for updates. Try again later.") });
    });
    return updater;
  }

  async function checkPortable() {
    setState({ status: "checking", error: null });
    try {
      const response = await fetchImpl(LATEST_RELEASE_API, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "GetVideosLocally-App" },
      });
      if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
      const release = await response.json();
      const latestVersion = String(release.tag_name || "").replace(/^v/, "");
      const newer = latestVersion && compareVersions(latestVersion, currentVersion) > 0;
      setState({
        status: newer ? "available-manual" : "up-to-date",
        latestVersion: latestVersion || currentVersion,
        lastChecked: Date.now(),
      });
    } catch (error) {
      logger.warn?.("Portable update check failed:", error.message);
      setState({ status: "error", error: tr("Couldn't check for updates. Try again later.") });
    }
  }

  async function check() {
    if (state.status === "ready" || state.status === "downloading") return { ...state };
    if (checking) return checking;
    checking = (async () => {
      try {
        if (!state.canSelfUpdate) {
          await checkPortable();
        } else {
          setState({ status: "checking", error: null });
          await getUpdater().checkForUpdates();
        }
      } catch (error) {
        logger.warn?.("Update check failed:", error?.message || error);
        if (state.status !== "ready") setState({ status: "error", error: tr("Couldn't check for updates. Try again later.") });
      } finally {
        checking = null;
      }
      return { ...state };
    })();
    return checking;
  }

  let installing = false;
  async function install() {
    if (state.status !== "ready" || !updater) return { ok: false, reason: "not-ready" };
    if (getActiveDownloadCount() > 0) return { ok: false, reason: "downloads-active" };
    if (installing) return { ok: true };
    installing = true;
    // Reply to the window first, then save state and hand over to the
    // installer: silent install, then reopen the app on the new version.
    setImmediate(async () => {
      try {
        await prepareForInstall();
      } catch (error) {
        logger.warn?.("Preparing for update failed:", error?.message || error);
      }
      updater.quitAndInstall(true, true);
    });
    return { ok: true };
  }

  return {
    check,
    install,
    getState: () => ({ ...state }),
  };
}

module.exports = { createAppUpdater, compareVersions, RELEASES_PAGE_URL };
