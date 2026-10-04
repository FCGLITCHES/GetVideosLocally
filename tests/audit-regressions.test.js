const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const { createRequire } = require("node:module");
const { createAuthMiddleware } = require("../backend/middleware/auth");
const { createRateLimiter } = require("../backend/middleware/rate-limit");
const { isLocalOrigin, createLocalRequestGuard } = require("../backend/middleware/local-origin");
const { assertMediaUrl } = require("../backend/utils/media-url");
const { writeJsonAtomic, readJsonFile } = require("../backend/utils/json-file");
const { sanitizeFilename, getUniqueFolderPath } = require("../backend/services/download-runner");
const { sanitizePathSegment } = require("../backend/utils/download-job-helpers");
const { HistoryIndex } = require("../backend/state/history-index");
const { createWebSocketHub } = require("../backend/websocket/client-hub");
const root = path.join(__dirname, "..");
const silent = { log() {}, info() {}, warn() {}, error() {} };
function response() {
  return { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
}
function serverFunction(name, context) {
  const source = fs.readFileSync(path.join(root, "server.js"), "utf8");
  const start = source.search(new RegExp(`  (?:async )?function ${name}\\(`));
  assert.ok(start >= 0);
  const rest = source.slice(start);
  const end = rest.slice(1).search(/\n  (?:async )?function /);
  return vm.runInNewContext(`${end < 0 ? rest : rest.slice(0, end + 1)}\n${name}`, context);
}

test("download files and fake Upgrade HTTP requests require authentication", () => {
  for (const req of [
    { method: "GET", path: "/downloads/private.mp4", headers: {} },
    { method: "POST", path: "/shutdown", headers: { upgrade: "websocket" } },
  ]) {
    const res = response(); let called = false;
    createAuthMiddleware("secret")(req, res, () => { called = true; });
    assert.equal(called, false); assert.equal(res.statusCode, 401);
  }
});

test("local-origin checks reject lookalikes, foreign ports and DNS rebinding", () => {
  for (const value of ["http://localhost.evil.test:9875", "http://127.0.0.1.evil.test:9875",
    "http://127.0.0.1:9876", "https://127.0.0.1:9875", "http://localhost:9875/path", "null"]) {
    assert.equal(isLocalOrigin(value, 9875), false, value);
  }
  assert.equal(isLocalOrigin("http://127.0.0.1:9875", 9875), true);
  assert.equal(isLocalOrigin("http://localhost:80", 80), true);
  const res = response();
  createLocalRequestGuard(9875)({ headers: { host: "attacker.test:9875" } }, res, () => assert.fail());
  assert.equal(res.statusCode, 403);
});

test("rotating X-Client-ID cannot bypass a rate limit", () => {
  const limit = createRateLimiter({ maxRequests: 1 });
  const first = response(); const second = response();
  limit({ ip: "127.0.0.1", headers: { "x-client-id": "one" } }, first, () => {});
  limit({ ip: "127.0.0.1", headers: { "x-client-id": "two" } }, second, () => assert.fail());
  assert.equal(second.statusCode, 429); assert.ok(second.headers["Retry-After"]);
});

test("media inputs reject command options, local-file schemes, credentials and wrong types", () => {
  for (const value of ["--exec=calc.exe", "file:///C:/secret.txt", "ftp://example.test/video",
    "https://user:pass@example.test/v", null, {}, "https://example.test/a\n--exec=calc"]) {
    assert.throws(() => assertMediaUrl(value));
  }
  assert.equal(assertMediaUrl("https://example.test/watch?v=x"), "https://example.test/watch?v=x");
  assert.equal(assertMediaUrl("abcdefghijk", true), "abcdefghijk");
  assert.throws(() => assertMediaUrl("--exec=calc", true));
});

test("untrusted titles cannot traverse folders or become yt-dlp output directives", () => {
  for (const sanitize of [sanitizeFilename, sanitizePathSegment]) {
    for (const title of ["..", ".", "  ", "CON", "NUL.mp4", "hello\u0000world", "%(title)s"]) {
      const result = sanitize(title);
      assert.ok(result && result !== "." && result !== "..");
      assert.doesNotMatch(result, /[%\u0000-\u001f]/);
      assert.doesNotMatch(result, /^(con|nul)(?:\.|$)/i);
    }
  }
});

test("playlist directory allocation resolves a real path and avoids existing folders", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gvl-playlist-"));
  try {
    fs.mkdirSync(path.join(dir, "Playlist"));
    const result = await getUniqueFolderPath(fs, dir, "Playlist");
    assert.equal(result, path.join(dir, "Playlist (1)"));
    const source = fs.readFileSync(path.join(root, "server.js"), "utf8");
    assert.match(source, /playlistFolderPath = await getUniqueFolderPath\(/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("concurrent JSON writes preserve the latest snapshot with no temporary-file collisions", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gvl-json-race-"));
  const file = path.join(dir, "history.json");
  try {
    await Promise.all(Array.from({ length: 20 }, (_, n) => writeJsonAtomic(file, { n })));
    assert.deepEqual(await readJsonFile(file), { n: 19 });
    assert.deepEqual(fs.readdirSync(dir), ["history.json"]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("failed Windows replacement restores the old JSON instead of deleting its backup", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gvl-json-rollback-"));
  const file = path.join(dir, "history.json"); fs.writeFileSync(file, '{"old":true}');
  const original = fs.promises.rename;
  fs.promises.rename = async (from, to) => {
    if (from.endsWith(".tmp") && to === file) throw Object.assign(new Error("locked"), { code: "EPERM" });
    return original(from, to);
  };
  try {
    await assert.rejects(writeJsonAtomic(file, { old: false }), /locked/);
    assert.deepEqual(await readJsonFile(file), { old: true });
  } finally { fs.promises.rename = original; fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a crash during JSON replacement recovers the backup on startup", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gvl-json-crash-"));
  const file = path.join(dir, "history.json");
  try {
    fs.writeFileSync(`${file}.bak`, '{"kept":true}');
    assert.deepEqual(await readJsonFile(file), { kept: true });
    assert.ok(fs.existsSync(file));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("history client IDs cannot write to Object.prototype", async () => {
  const history = new HistoryIndex({ logger: silent });
  await history.syncClientHistory("__proto__", [{ path: "/downloads/a.mp4", name: "a" }]);
  assert.equal(Object.prototype.items, undefined);
  assert.equal(history.getClientHistory("__proto__").items.length, 1);
});

test("an old WebSocket closing does not disconnect its replacement", async () => {
  const state = { clients: new Map(), clientAutoUpdateSettings: new Map() };
  const wss = new EventEmitter();
  const hub = createWebSocketHub({ WebSocket: { OPEN: 1 }, urlParser: require("node:url"), state,
    onMessage: async () => {}, logger: silent });
  hub.attach(wss);
  const socket = () => Object.assign(new EventEmitter(), { readyState: 1, send() {}, close() { this.emit("close"); } });
  const first = socket(); const second = socket();
  wss.emit("connection", first, { url: "/?clientId=same" });
  wss.emit("connection", second, { url: "/?clientId=same" });
  first.emit("close");
  assert.equal(state.clients.get("same"), second);
  second.emit("close"); assert.equal(state.clients.size, 0);
});

test("long-range schedules re-arm a capped timer instead of running immediately", () => {
  const timers = new Map(); let delay; let callback; let executed = false;
  const queue = serverFunction("queueScheduledTimer", {
    Date, Number, Math, scheduledDownloadTimers: timers, clearTimeout() {},
    setTimeout(fn, ms) { callback = fn; delay = ms; return {}; },
    scheduleDownloadExecution: async () => { executed = true; }, logger: silent,
  });
  queue("later", new Date(Date.now() + 60 * 86400000).toISOString());
  assert.equal(delay, 2147483647); callback(); assert.equal(executed, false);
});

test("another client cannot pause or take over a resumable download", async () => {
  const paused = new Map([["job", { clientId: "owner" }]]);
  const context = { pausedDownloads: paused, downloadQueue: new Map(),
    activeProcesses: new Map(), logger: silent };
  await assert.rejects(serverFunction("handlePauseRequest", context)("intruder", "job"), /not found/);
  await assert.rejects(serverFunction("handleResumeRequest", context)("intruder", "job"), /not found/);
  assert.equal(paused.get("job").clientId, "owner");
});

test("cancelling a playlist stops running children and retains the parent cancellation flag", async () => {
  const parent = { clientId: "owner", isMeta: true };
  const child = { clientId: "owner", itemData: { clientId: "owner", parentPlaylistId: "parent" } };
  const queue = new Map([["parent", parent]]); const active = new Map([["child", child]]);
  const cancel = serverFunction("handleCancelRequest", { downloadQueue: queue, activeProcesses: active,
    pausedDownloads: new Map(), sendMessageToClient() {}, markDirty() {}, logger: silent,
    downloadState: { async saveRuntimeState() {} }, setTimeout(fn) { fn(); } });
  await cancel("owner", "parent");
  assert.equal(child.cancelled, true); assert.equal(active.size, 0); assert.equal(parent.cancelled, true);
  assert.equal(queue.get("parent"), parent);
});

function electronHandlers() {
  const source = fs.readFileSync(path.join(root, "electron-main.js"), "utf8");
  const handlers = new Map(); const listeners = new Map();
  const sender = { mainFrame: { url: "http://127.0.0.1:9875/" } };
  const context = { URL, path, fs, Buffer, console: silent, serverPort: 9875, serverToken: "secret",
    pathToFileURL: require("node:url").pathToFileURL, mainWindow: { webContents: sender }, cookieWindow: null,
    BrowserWindow: { fromWebContents: () => ({}) },
    ipcMain: { handle(name, fn) { handlers.set(name, fn); }, on(name, fn) { listeners.set(name, fn); } },
    clipboard: { writeText(text) { context.clipboardText = text; } } };
  vm.runInNewContext(source.slice(source.indexOf("function assertTrustedIpcSender")), context);
  return { context, handlers, listeners, event: { sender, senderFrame: sender.mainFrame } };
}

test("every privileged Electron handler rejects a foreign renderer and subframe", async () => {
  const { handlers, event } = electronHandlers();
  const foreign = { ...event, senderFrame: { url: "http://evil.test/" } };
  for (const [name, fn] of handlers) {
    await assert.rejects(async () => fn(foreign), /Unauthorized IPC caller/, name);
  }
  const framed = { ...event, senderFrame: { url: event.senderFrame.url } };
  await assert.rejects(handlers.get("get-server-token")(framed), /Unauthorized/);
  assert.equal(await handlers.get("get-server-token")(event), "secret");
  event.senderFrame.url = "http://evil.test/";
  await assert.rejects(handlers.get("get-server-token")(event), /Unauthorized/);
});

test("the preload clipboard-write channel has a working trusted handler", async () => {
  const { context, handlers, event } = electronHandlers();
  await handlers.get("writeClipboardText")(event, "copied");
  assert.equal(context.clipboardText, "copied");
  await assert.rejects(handlers.get("writeClipboardText")(event, {}), /must be a string/);
});

function apiRoutes(result) {
  const file = path.join(root, "backend/routes/api-routes.js"); const nativeRequire = createRequire(file);
  const sent = []; const routes = new Map(); const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, "utf8"), { module, process, console, require(name) {
    if (name === "resend") return { Resend: class { constructor() {
      this.emails = { async send(body) { sent.push(body); return result; } };
    } } };
    return nativeRequire(name);
  } });
  const app = { post(name, fn) { routes.set(name, fn); }, get(name, fn) { routes.set(name, fn); },
    delete(name, fn) { routes.set(name, fn); } };
  const calls = [];
  module.exports.registerApiRoutes(app, { logger: silent, checkAndUpdateTools: async (...args) => {
    calls.push(args); return {}; }, getToolVersion: async () => "test", getLastUpdateCheck: () => 0 });
  return { routes, sent, calls };
}

test("support emails escape HTML, use replyTo and return the provider message ID", async () => {
  const original = process.env.RESEND_API_KEY; process.env.RESEND_API_KEY = "test-never-sent";
  try {
    const { routes, sent } = apiRoutes({ data: { id: "message-id" }, error: null }); const res = response();
    await routes.get("/api/send-support-email")({ body: { email: "a@example.test", type: "<b>type</b>",
      message: '<img src=x onerror="evil()">', clientId: "<script>x</script>" } }, res);
    assert.equal(res.statusCode, 200); assert.equal(res.body.id, "message-id");
    assert.equal(sent[0].replyTo, "a@example.test"); assert.doesNotMatch(sent[0].html, /<img src=x|<script>x|<b>type/);
    assert.match(sent[0].html, /&lt;img/);
  } finally { if (original === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = original; }
});

test("support provider errors are reported as failures and invalid inputs never send", async () => {
  const original = process.env.RESEND_API_KEY; process.env.RESEND_API_KEY = "test-never-sent";
  try {
    const { routes, sent } = apiRoutes({ data: null, error: { message: "rejected" } });
    const route = routes.get("/api/send-support-email"); const valid = response();
    await route({ body: { email: "a@example.test", message: "help" } }, valid);
    assert.equal(valid.statusCode, 502);
    const bad = response(); await route({ body: { email: "bad\r\nBcc: evil", message: {} } }, bad);
    assert.equal(bad.statusCode, 400); assert.equal(sent.length, 1);
  } finally { if (original === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = original; }
});

test("Force Update bypasses recent-check throttling", async () => {
  const { routes, calls } = apiRoutes({});
  await routes.get("/force-update-tools")({}, response());
  assert.equal(calls[0][0], true);
});

test("diagnostics resolves package metadata independently of the launch directory", async () => {
  const original = process.cwd(); const res = response(); res.send = value => { res.body = value; };
  try {
    const { routes } = apiRoutes({}); process.chdir(os.tmpdir());
    await routes.get("/diagnostics")({}, res);
    assert.equal(res.statusCode, 200); assert.match(res.body, /getvideoslocally/);
  } finally { process.chdir(original); }
});

test("environment ports must be entirely numeric", () => {
  const { loadEnv } = require("../backend/config/env");
  for (const value of ["123garbage", "123.5", "123e2"]) assert.equal(loadEnv({ PORT: value }, silent).PORT, 9875);
});

test("History Play cannot launch executables or scripts", async () => {
  const { createDesktopFileActions } = require("../backend/services/desktop-file-actions");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gvl-play-safety-"));
  try {
    const file = path.join(dir, "dangerous.exe"); fs.writeFileSync(file, "unused");
    const actions = createDesktopFileActions({ shell: { async openPath() { assert.fail("Executable was launched"); } } });
    assert.equal((await actions.openMediaFile(dir, file)).success, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("telemetry imports safely without browser storage and remains opted out", () => {
  const { telemetry } = require("../scripts/telemetry");
  assert.equal(telemetry.enabled, false); assert.equal(telemetry.anonymousId, null);
  assert.equal(telemetry.isOptedIn(), false); assert.equal(telemetry.endpoint, "");
});

test("close protection cancels the native event before awaiting renderer state", async () => {
  const source = fs.readFileSync(path.join(root, "electron-main.js"), "utf8");
  const start = source.indexOf("  mainWindow.on('close', async (event) => {");
  const end = source.indexOf("\n  mainWindow.on('move'", start);
  let handler; let requested = false; let destroyed = false; let prevented = false;
  const win = { on(_, fn) { handler = fn; }, isDestroyed() { return destroyed; },
    webContents: { isDestroyed: () => false, executeJavaScript: async () => 1,
      send() { requested = true; } }, close() { destroyed = true; } };
  vm.runInNewContext(source.slice(start, end), { mainWindow: win, saveWindowState() {},
    isQuitting: false, activeDownloadCount: 0, Number, console: silent });
  const pending = handler({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true); await pending;
  assert.equal(requested, true); assert.equal(destroyed, false);
});

test("external navigation rejects foreign local ports and executable URL schemes", () => {
  const source = fs.readFileSync(path.join(root, "electron-main.js"), "utf8");
  const start = source.indexOf("function secureWindowNavigation");
  const end = source.indexOf("async function createWindow", start); const opened = []; const events = new Map();
  let windowHandler;
  const win = { webContents: { on(k, fn) { events.set(k, fn); }, setWindowOpenHandler(fn) { windowHandler = fn; } } };
  const configure = vm.runInNewContext(source.slice(start, end) + "\nsecureWindowNavigation", {
    URL, path, __dirname: root, pathToFileURL: require("node:url").pathToFileURL,
    serverPort: 9875, cookieWindow: null, console: silent,
    shell: { async openExternal(value) { opened.push(value); } } });
  configure(win);
  assert.equal(windowHandler({ url: "http://127.0.0.1:9876/" }).action, "deny");
  assert.equal(windowHandler({ url: "file:///C:/bad.exe" }).action, "deny");
  assert.equal(windowHandler({ url: "ms-msdt:exploit" }).action, "deny");
  assert.equal(windowHandler({ url: "http://127.0.0.1:9875/public/contact.html" }).action, "allow");
  assert.equal(opened.length, 1); assert.ok(events.has("will-redirect"));
  assert.match(source, /sandbox: true/); assert.doesNotMatch(source, /sandbox: false/);
});

test("glob characters in a title cannot delete a differently named sibling", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gvl-glob-safety-"));
  try {
    for (const name of ["[ab].mp4", "a.mp4", "b.mp4"]) fs.writeFileSync(path.join(dir, name), "fixture");
    const context = { path, fs, logger: silent, globAsync: require("node:util").promisify(require("glob")) };
    context.escapeGlob = serverFunction("escapeGlob", {});
    await serverFunction("cleanupFilesByTemplate", context)(path.join(dir, "[ab].%(ext)s"), "test");
    assert.deepEqual(fs.readdirSync(dir).sort(), ["a.mp4", "b.mp4"]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("triage workflow parses and exposes the output its label conditions read", () => {
  const source = fs.readFileSync(path.join(root, ".github/workflows/triage-bot.yml"), "utf8");
  const doc = require("js-yaml").load(source);
  assert.ok(doc.jobs.triage.steps.length);
  assert.match(doc.jobs.triage.steps[0].with.script, /core\.setOutput\('hasDiagnostics'/);
});

test("generic playlist entries retain their own downloadable URLs", async () => {
  const { createPlaylistService } = require("../backend/services/playlist-service");
  const service = createPlaylistService({ logger: silent, sendMessageToClient() {},
    runYtDlpCommand: async (_, args) => ({ stdout: args.some((arg) => String(arg).startsWith("%(id)s\t%(title)s\t%(webpage_url,url)s"))
      ? "42\tClip\thttps://example.test/videos/42\n" : "Collection\n" }) });
  const result = await service.fetchPlaylistContext("audit", "https://example.test/collection", "job");
  assert.equal(result.items[0].id, "42"); assert.equal(result.items[0].url, "https://example.test/videos/42");
});

test("normal app close requests authenticated shutdown and waits for the actual backend exit", () => {
  const source = fs.readFileSync(path.join(root, "electron-main.js"), "utf8");
  const start = source.indexOf("let quitCleanupStarted"); const end = source.indexOf("app.on('activate'", start);
  let handler; let quitCount = 0; let requestOptions; let ended = false;
  const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null, killed: true,
    kill() { assert.fail("Backend should be allowed to persist before termination"); } });
  vm.runInNewContext(source.slice(start, end), { app: { on(_, fn) { handler = fn; }, quit() { quitCount++; } },
    powerSaveBlockerId: null, serverProcess: child, serverPort: 9875, serverToken: "secret", isQuitting: true,
    setTimeout() { return {}; }, clearTimeout() {}, console: silent,
    require() { return { request(options) { requestOptions = options;
      return { on() {}, end() { ended = true; } }; } }; } });
  handler({ preventDefault() {} });
  assert.equal(ended, true); assert.equal(quitCount, 0);
  assert.equal(requestOptions.headers["X-Server-Token"], "secret");
  child.emit("exit", 0); assert.equal(quitCount, 1);
});
