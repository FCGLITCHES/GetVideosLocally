"use strict";

// Opt-in, anonymous usage statistics.
//
// Off by default. Nothing is recorded, stored or sent until the user turns on
// "Share anonymous usage statistics" in Settings. Only coarse, allowlisted
// values leave the machine: app version, install channel, OS family/major
// version, CPU architecture, UI language, and per-download outcome buckets.
// Source URLs, titles, file names, paths, usernames, hostnames and cookies are
// never included. The install ID is a random UUID created on opt-in and
// deleted on opt-out.

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { writeJsonAtomic } = require("../utils/json-file");
const { ERROR_CATEGORIES } = require("./error-classifier");

const DEFAULT_ENDPOINT = "https://getvideoslocally.com/api/app/telemetry";
const STATE_FILE_NAME = "usage-telemetry.json";
const MAX_QUEUE = 200;
const MAX_BATCH = 50;
const FLUSH_INTERVAL_MS = 10 * 60 * 1000;
const STARTUP_FLUSH_DELAY_MS = 60 * 1000;
const DOWNLOAD_FLUSH_DEBOUNCE_MS = 60 * 1000;
const REQUEST_TIMEOUT_MS = 10 * 1000;
const SHUTDOWN_TIMEOUT_MS = 2000;
const BASE_BACKOFF_MS = 60 * 1000;
const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000;

const PLATFORM_DOMAINS = [
  ["youtube", ["youtube.com", "youtu.be", "youtube-nocookie.com"]],
  ["tiktok", ["tiktok.com"]],
  ["instagram", ["instagram.com"]],
  ["x", ["x.com", "twitter.com"]],
  ["facebook", ["facebook.com", "fb.watch", "fb.com"]],
  ["vimeo", ["vimeo.com"]],
  ["reddit", ["reddit.com", "redd.it"]],
  ["twitch", ["twitch.tv"]],
  ["soundcloud", ["soundcloud.com"]],
];
const PLATFORMS = Object.freeze([
  ...PLATFORM_DOMAINS.map(([bucket]) => bucket),
  "other",
]);
const DOWNLOAD_RESULTS = Object.freeze(["success", "failed", "cancelled"]);
const ERROR_CATEGORY_VALUES = new Set(Object.values(ERROR_CATEGORIES));
const AUDIO_FORMATS = new Set(["mp3", "wav", "m4a", "opus", "flac"]);
const VERSION_PATTERN = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z.]{1,24})?$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OFF_VALUES = new Set(["0", "false", "off", "no", "disabled"]);

function platformFromUrl(value) {
  let hostname;
  try {
    hostname = new URL(String(value || "")).hostname
      .toLowerCase()
      .replace(/\.$/, "");
  } catch (_) {
    return "other";
  }
  for (const [bucket, domains] of PLATFORM_DOMAINS) {
    if (domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) {
      return bucket;
    }
  }
  return "other";
}

function mediaFromFormat(format) {
  return AUDIO_FORMATS.has(String(format || "").toLowerCase()) ? "audio" : "video";
}

function durationBucket(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (value < 60) return "under_1m";
  if (value < 5 * 60) return "1_5m";
  if (value < 20 * 60) return "5_20m";
  if (value < 60 * 60) return "20_60m";
  return "over_60m";
}

function sizeBucket(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return null;
  const megabyte = 1024 * 1024;
  if (value < 10 * megabyte) return "under_10mb";
  if (value < 100 * megabyte) return "10_100mb";
  if (value < 1024 * megabyte) return "100mb_1gb";
  return "over_1gb";
}

function fileSize(filePath, fsImpl = fs) {
  try {
    return fsImpl.statSync(filePath).size;
  } catch (_) {
    return null;
  }
}

function languageOnly(value) {
  const match = /^([a-z]{2,3})(?:[-_]|$)/i.exec(String(value || "").trim());
  return match ? match[1].toLowerCase() : null;
}

function describeSystem({
  platform = process.platform,
  release = os.release(),
  arch = process.arch,
  locale,
} = {}) {
  const osName =
    platform === "win32" ? "windows"
      : platform === "darwin" ? "macos"
        : platform === "linux" ? "linux"
          : "other";
  let osVersion = null;
  if (osName === "windows") {
    const [major, , build] = String(release || "").split(".").map(Number);
    if (major === 10) osVersion = build >= 22000 ? "11" : "10";
  }
  let detectedLocale = locale;
  if (!detectedLocale) {
    try {
      detectedLocale = Intl.DateTimeFormat().resolvedOptions().locale;
    } catch (_) {
      detectedLocale = null;
    }
  }
  return {
    os: osName,
    os_version: osVersion,
    arch: ["x64", "arm64", "ia32"].includes(arch) ? arch : "other",
    locale: languageOnly(detectedLocale),
  };
}

// The NSIS installer places an uninstaller next to the executable; the
// portable build does not.
function detectChannel(execPath = process.execPath, fsImpl = fs) {
  try {
    const directory = path.dirname(String(execPath || ""));
    return fsImpl.existsSync(path.join(directory, "Uninstall GetVideosLocally.exe"))
      ? "installer"
      : "portable";
  } catch (_) {
    return "portable";
  }
}

function isLoopbackUrl(value) {
  try {
    const parsed = new URL(value);
    return (
      ["http:", "https:"].includes(parsed.protocol) &&
      ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
    );
  } catch (_) {
    return false;
  }
}

// Packaged builds send to the public endpoint. Unpackaged/dev builds never
// send unless GVL_TELEMETRY_ENDPOINT points at a loopback address.
// GVL_TELEMETRY=0 disables everything.
function resolveEndpoint(env = process.env) {
  if (OFF_VALUES.has(String(env.GVL_TELEMETRY ?? "").trim().toLowerCase())) {
    return { endpoint: null, reason: "disabled_by_environment" };
  }
  const override = String(env.GVL_TELEMETRY_ENDPOINT || "").trim();
  if (override) {
    return isLoopbackUrl(override)
      ? { endpoint: override, reason: "local_endpoint" }
      : { endpoint: null, reason: "endpoint_not_local" };
  }
  if (String(env.GVL_APP_PACKAGED || "") === "1") {
    return { endpoint: DEFAULT_ENDPOINT, reason: "packaged" };
  }
  return { endpoint: null, reason: "development_build" };
}

function buildDownloadProps({
  result,
  url,
  format,
  isPlaylistItem = false,
  errorCategory,
  durationSeconds,
  sizeBytes,
} = {}) {
  if (!DOWNLOAD_RESULTS.includes(result)) return null;
  const props = {
    result,
    media: mediaFromFormat(format),
    in_playlist: isPlaylistItem === true,
    platform: platformFromUrl(url),
  };
  if (result === "failed") {
    props.error_category = ERROR_CATEGORY_VALUES.has(errorCategory)
      ? errorCategory
      : "unknown";
  }
  const duration = durationBucket(durationSeconds);
  if (duration) props.duration_bucket = duration;
  if (result === "success") {
    const size = sizeBucket(sizeBytes);
    if (size) props.size_bucket = size;
  }
  return props;
}

function buildPayload({ installId, appVersion, channel, events }) {
  return {
    install_id: installId,
    app_version: appVersion,
    channel,
    events: events.map(({ name, at, props }) => ({ name, at, props })),
  };
}

function emptyState() {
  return { enabled: false, installId: null, lastSeenVersion: null, queue: [] };
}

function sanitizeLoadedState(raw) {
  if (!raw || typeof raw !== "object" || raw.enabled !== true) return emptyState();
  if (!UUID_PATTERN.test(String(raw.installId || ""))) return emptyState();
  const queue = Array.isArray(raw.queue)
    ? raw.queue
        .filter(
          (event) =>
            event &&
            ["app_open", "app_update", "download_finished"].includes(event.name) &&
            typeof event.at === "string" &&
            VERSION_PATTERN.test(String(event.v || "")) &&
            event.props &&
            typeof event.props === "object",
        )
        .slice(-MAX_QUEUE)
    : [];
  return {
    enabled: true,
    installId: String(raw.installId),
    lastSeenVersion: VERSION_PATTERN.test(String(raw.lastSeenVersion || ""))
      ? String(raw.lastSeenVersion)
      : null,
    queue,
  };
}

function createUsageTelemetry({
  userDataPath,
  appVersion,
  env = process.env,
  fetchImpl = globalThis.fetch,
  fsImpl = fs,
  writeJson = writeJsonAtomic,
  now = () => Date.now(),
  randomUUID = () => crypto.randomUUID(),
  timers = { setTimeout, clearTimeout, setInterval, clearInterval },
  system,
  channel,
  logger = console,
} = {}) {
  const statePath = userDataPath ? path.join(userDataPath, STATE_FILE_NAME) : null;
  const version = VERSION_PATTERN.test(String(appVersion || "")) ? String(appVersion) : null;
  const { endpoint, reason } = resolveEndpoint(env);
  let systemInfo = system || null;
  let resolvedChannel = channel || null;
  let state = emptyState();
  let ioChain = Promise.resolve();
  let flushPromise = null;
  let inFlight = null;
  let failures = 0;
  let backoffUntil = 0;
  let intervalTimer = null;
  let startupTimer = null;
  let downloadTimer = null;
  let stopped = false;

  const canRecord = () => Boolean(state.enabled && endpoint && version && !stopped);
  const unref = (handle) => {
    if (handle && typeof handle.unref === "function") handle.unref();
    return handle;
  };

  function getSystem() {
    if (!systemInfo) systemInfo = describeSystem({ locale: env.GVL_APP_LOCALE });
    return systemInfo;
  }

  function getChannel() {
    if (!resolvedChannel) resolvedChannel = detectChannel(process.execPath, fsImpl);
    return resolvedChannel;
  }

  function persist() {
    if (!statePath) return ioChain;
    ioChain = ioChain
      .catch(() => {})
      .then(async () => {
        if (state.enabled) {
          await writeJson(statePath, state);
        } else {
          await fsImpl.promises.rm(statePath, { force: true });
          await fsImpl.promises.rm(`${statePath}.bak`, { force: true });
        }
      })
      .catch((error) => logger.warn?.("[usage-telemetry] Could not save state:", error.message));
    return ioChain;
  }

  function clearTimers() {
    for (const handle of [startupTimer, downloadTimer]) if (handle) timers.clearTimeout(handle);
    if (intervalTimer) timers.clearInterval(intervalTimer);
    startupTimer = downloadTimer = intervalTimer = null;
  }

  function startTimers() {
    if (!canRecord() || intervalTimer) return;
    startupTimer = unref(timers.setTimeout(() => {
      startupTimer = null;
      void flush();
    }, STARTUP_FLUSH_DELAY_MS));
    intervalTimer = unref(timers.setInterval(() => void flush(), FLUSH_INTERVAL_MS));
  }

  function enqueue(name, props) {
    if (!canRecord()) return false;
    state.queue.push({ name, at: new Date(now()).toISOString(), v: version, props });
    if (state.queue.length > MAX_QUEUE) state.queue.splice(0, state.queue.length - MAX_QUEUE);
    void persist();
    return true;
  }

  function recordLaunch() {
    if (state.lastSeenVersion && state.lastSeenVersion !== version) {
      enqueue("app_update", { from_version: state.lastSeenVersion, to_version: version });
    }
    state.lastSeenVersion = version;
    enqueue("app_open", { ...getSystem() });
  }

  async function init() {
    if (!statePath) return getStatus();
    try {
      const raw = fsImpl.existsSync(statePath)
        ? JSON.parse(fsImpl.readFileSync(statePath, "utf8"))
        : null;
      state = sanitizeLoadedState(raw);
    } catch (_) {
      state = emptyState();
    }
    if (canRecord()) {
      recordLaunch();
      startTimers();
    }
    return getStatus();
  }

  async function setEnabled(enabled) {
    const next = enabled === true;
    if (next === state.enabled) return getStatus();
    if (next) {
      state = { enabled: true, installId: randomUUID(), lastSeenVersion: null, queue: [] };
      failures = 0;
      backoffUntil = 0;
      recordLaunch();
      await persist();
      startTimers();
    } else {
      // Stop immediately: drop the queue, forget the ID, abort any request.
      state = emptyState();
      clearTimers();
      if (inFlight) inFlight.abort();
      await persist();
    }
    return getStatus();
  }

  function recordDownloadFinished(details) {
    if (!canRecord()) return false;
    const props = buildDownloadProps(details);
    if (!props) return false;
    const recorded = enqueue("download_finished", props);
    if (recorded) {
      if (downloadTimer) timers.clearTimeout(downloadTimer);
      downloadTimer = unref(timers.setTimeout(() => {
        downloadTimer = null;
        void flush();
      }, DOWNLOAD_FLUSH_DEBOUNCE_MS));
    }
    return recorded;
  }

  async function send(batch, batchVersion, timeoutMs) {
    if (typeof fetchImpl !== "function") return "retry";
    const controller = new AbortController();
    inFlight = controller;
    const timeout = unref(timers.setTimeout(() => controller.abort(), timeoutMs));
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload({
          installId: state.installId,
          appVersion: batchVersion,
          channel: getChannel(),
          events: batch,
        })),
        signal: controller.signal,
      });
      if (response && response.ok) return "sent";
      const status = Number(response?.status || 0);
      return status === 429 || status >= 500 || status === 0 ? "retry" : "rejected";
    } catch (_) {
      return "retry";
    } finally {
      timers.clearTimeout(timeout);
      if (inFlight === controller) inFlight = null;
    }
  }

  function flush({ timeoutMs = REQUEST_TIMEOUT_MS, ignoreBackoff = false } = {}) {
    if (flushPromise) return flushPromise;
    if (!state.enabled || !endpoint || !state.queue.length) return Promise.resolve();
    if (!ignoreBackoff && now() < backoffUntil) return Promise.resolve();
    flushPromise = (async () => {
      try {
        while (state.enabled && state.queue.length) {
          const installId = state.installId;
          const batchVersion = state.queue[0].v;
          const batch = [];
          for (const event of state.queue) {
            if (event.v !== batchVersion || batch.length >= MAX_BATCH) break;
            batch.push(event);
          }
          const outcome = await send(batch, batchVersion, timeoutMs);
          // The user may have opted out (or back in) while the request ran.
          if (!state.enabled || state.installId !== installId) return;
          if (outcome === "retry") {
            failures += 1;
            backoffUntil = now() + Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (failures - 1));
            return;
          }
          // "sent" or "rejected" (a 4xx will never succeed, so do not retry it).
          const sent = new Set(batch);
          state.queue = state.queue.filter((event) => !sent.has(event));
          failures = 0;
          backoffUntil = 0;
          await persist();
        }
      } catch (error) {
        logger.warn?.("[usage-telemetry] Flush failed:", error.message);
      } finally {
        flushPromise = null;
      }
    })();
    return flushPromise;
  }

  async function shutdown({ timeoutMs = SHUTDOWN_TIMEOUT_MS } = {}) {
    clearTimers();
    if (canRecord()) {
      let timer;
      await Promise.race([
        flush({ timeoutMs, ignoreBackoff: true }),
        new Promise((resolve) => { timer = unref(timers.setTimeout(resolve, timeoutMs + 250)); }),
      ]).catch(() => {});
      timers.clearTimeout(timer);
    }
    stopped = true;
    await ioChain.catch(() => {});
  }

  function getStatus() {
    return {
      enabled: state.enabled,
      available: Boolean(endpoint && version),
      reason: endpoint ? (version ? reason : "unknown_version") : reason,
      queued: state.queue.length,
    };
  }

  return {
    init,
    setEnabled,
    recordDownloadFinished,
    flush,
    shutdown,
    getStatus,
    // Exposed for tests only.
    _getState: () => state,
    _getEndpoint: () => endpoint,
  };
}

module.exports = {
  DEFAULT_ENDPOINT,
  DOWNLOAD_RESULTS,
  MAX_BATCH,
  MAX_QUEUE,
  PLATFORMS,
  STATE_FILE_NAME,
  buildDownloadProps,
  buildPayload,
  createUsageTelemetry,
  describeSystem,
  detectChannel,
  durationBucket,
  fileSize,
  isLoopbackUrl,
  languageOnly,
  mediaFromFormat,
  platformFromUrl,
  resolveEndpoint,
  sizeBucket,
};
