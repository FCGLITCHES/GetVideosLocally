"use strict";

// Runs against isolated user data and a generated, local media fixture.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { fork, execFileSync } = require("node:child_process");
const { once } = require("node:events");
const WebSocket = require("ws");

async function run() {
  const root = path.join(__dirname, "..");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gvl-live-audit-"));
  const checks = [];
  let child; let mediaServer; let socket; let base; let token;
  const log = fs.createWriteStream(path.join(os.tmpdir(), "gvl-audit-runtime-server.log"));
  const passed = name => { checks.push(name); console.log(`PASS ${name}`); };
  try {
    const fixture = path.join(dir, "fixture.mp4");
    execFileSync(path.join(root, "bin/ffmpeg.exe"), ["-y", "-f", "lavfi", "-i",
      "testsrc=size=160x120:rate=12", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "1",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", fixture], { stdio: "ignore", timeout: 30000 });
    mediaServer = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": fs.statSync(fixture).size });
      fs.createReadStream(fixture).pipe(res);
    });
    mediaServer.listen(0, "127.0.0.1"); await once(mediaServer, "listening");
    fs.mkdirSync(path.join(dir, "data")); fs.mkdirSync(path.join(dir, "downloads"));
    fs.writeFileSync(path.join(dir, "downloads/private.mp4"), "private fixture");
    fs.writeFileSync(path.join(dir, "paused_jobs.json"), JSON.stringify({ ownerJob: {
      clientId: "owner", title: "Owned paused fixture", videoUrl: "https://example.test/video", format: "mp4",
    } }));
    child = fork(path.join(root, "server.js"), [], { cwd: os.tmpdir(), silent: true, env: {
      ...process.env, USER_DATA_PATH: dir,
      ELECTRON_RUN_AS_NODE: "1", PORT: "19875", LOG_LEVEL: "warn",
    } });
    child.stdout.pipe(log); child.stderr.pipe(log);
    const ready = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Server startup timed out")), 30000);
      child.on("message", value => { if (value.type === "server_ready") { clearTimeout(timeout); resolve(value); } });
      child.on("error", reject); child.on("exit", code => { if (!base) reject(new Error(`Server exited ${code}`)); });
    });
    base = `http://127.0.0.1:${ready.port}`; token = ready.serverToken;
    const api = (route, body, method = body ? "POST" : "GET") => fetch(base + route, {
      method, headers: { "X-Server-Token": token, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60000),
    });
    assert.equal((await fetch(base)).status, 200); passed("isolated backend starts from a foreign working directory");
    assert.equal((await fetch(base + "/downloads/private.mp4")).status, 401);
    assert.equal((await api("/downloads/private.mp4")).status, 200); passed("media files require a token");
    const spoofedUpgradeStatus = await new Promise((resolve, reject) => {
      const request = http.request(base + "/shutdown", { method: "POST", headers: { Upgrade: "websocket" } }, response => {
        response.resume(); resolve(response.statusCode);
      }); request.on("error", reject); request.end();
    });
    assert.equal(spoofedUpgradeStatus, 401);
    passed("fake HTTP Upgrade does not bypass authentication");
    const spoofedHostStatus = await new Promise((resolve, reject) => {
      const request = http.get(base, { headers: { Host: "evil.test:" + ready.port } }, response => {
        response.resume(); resolve(response.statusCode);
      }); request.on("error", reject);
    });
    assert.equal(spoofedHostStatus, 403);
    assert.equal((await fetch(base, { headers: { Origin: "http://localhost.evil.test:" + ready.port } })).status, 403);
    passed("Host and Origin spoofing rejected on the real listener");
    await new Promise((resolve, reject) => {
      const denied = new WebSocket(base.replace("http:", "ws:") + "/?clientId=bad");
      denied.on("unexpected-response", (_, response) => {
        try { assert.equal(response.statusCode, 401); response.resume(); denied.terminate(); resolve(); } catch (error) { reject(error); }
      });
      denied.on("open", () => { denied.close(); reject(new Error("Unauthenticated WebSocket opened")); });
      denied.on("error", () => {});
    }); passed("unauthenticated WebSocket upgrades rejected");
    socket = new WebSocket(base.replace("http:", "ws:") + `/?clientId=audit&token=${token}`);
    const messages = []; socket.on("message", value => messages.push(JSON.parse(value)));
    await once(socket, "open"); socket.send(JSON.stringify({ type: "auto_update_preference", enabled: false }));
    const replacement = new WebSocket(base.replace("http:", "ws:") + `/?clientId=audit&token=${token}`);
    const oldClosed = once(socket, "close"); await once(replacement, "open"); await oldClosed;
    socket = replacement; socket.on("message", value => messages.push(JSON.parse(value)));
    socket.send(JSON.stringify({ type: "auto_update_preference", enabled: false }));
    passed("authenticated WebSocket reconnect remains connected");
    const oversized = new WebSocket(base.replace("http:", "ws:") + `/?clientId=oversized&token=${token}`);
    oversized.on("error", () => {}); await once(oversized, "open");
    const cappedClose = once(oversized, "close"); oversized.send(Buffer.alloc(1024 * 1024 + 1));
    assert.equal((await cappedClose)[0], 1009); passed("oversized WebSocket frames close at the configured payload cap");
    for (const route of ["/video-info", "/playlist-preview"]) {
      assert.equal((await api(route, { clientId: "audit", url: "--exec=calc.exe" })).status, 400);
    } passed("option injection rejected by live metadata APIs");
    const scheduledFor = new Date(Date.now() + 60 * 86400000).toISOString();
    const scheduled = await (await api("/scheduled-downloads", { clientId: "audit", url: "https://example.test/video",
      format: "mp4", quality: "720p", scheduledFor })).json();
    assert.ok(scheduled.scheduleId);
    const jobs = await (await api("/scheduled-downloads?clientId=audit")).json();
    assert.equal(jobs.items.length, 1); passed("60-day schedule stays queued");
    await api(`/scheduled-downloads/${scheduled.scheduleId}?clientId=audit`, null, "DELETE");
    socket.send(JSON.stringify({ type: "resume", itemId: "ownerJob" }));
    await new Promise(resolve => setTimeout(resolve, 100));
    const owned = await (await api("/recoverable-downloads?clientId=owner")).json();
    assert.equal(owned.items.length, 1); passed("cross-client resume leaves the owner's job intact");
    const diagnostics = await api("/diagnostics"); assert.equal(diagnostics.status, 200);
    assert.match(await diagnostics.text(), /GetVideosLocally Diagnostics/); passed("real tool diagnostics work outside repository cwd");
    const finished = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Local download timed out")), 120000);
      socket.on("message", value => {
        const message = JSON.parse(value);
        if (message.type === "complete") { clearTimeout(timeout); resolve(message); }
        if (message.type === "error" && message.itemId && !String(message.itemId).startsWith("info_")) {
          clearTimeout(timeout); reject(new Error(message.message));
        }
      });
    });
    socket.send(JSON.stringify({ type: "download_request", format: "mp4", quality: "720p", source: "generic",
      url: `http://127.0.0.1:${mediaServer.address().port}/fixture.mp4`, downloadFolder: path.join(dir, "saved") }));
    const completed = await finished;
    assert.ok(fs.existsSync(completed.fullPath)); assert.ok(fs.statSync(completed.fullPath).size > 0);
    const probe = JSON.parse(execFileSync(path.join(root, "bin/ffprobe.exe"), ["-v", "error", "-show_streams",
      "-of", "json", completed.fullPath], { encoding: "utf8", timeout: 30000 }));
    assert.ok(probe.streams.some(stream => stream.codec_type === "video"));
    passed("real yt-dlp download produces readable media in the requested folder");
    // Complete is emitted just before the persisted history write; poll that affected state.
    let history;
    for (let n = 0; n < 30; n++) {
      history = await (await api("/history-index?clientId=audit")).json();
      if (history.items.some(item => item.fullPath === completed.fullPath)) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(history.items.some(item => item.fullPath === completed.fullPath));
    assert.match(fs.readFileSync(path.join(dir, "data/history-index.json"), "utf8"), /fixture/);
    passed("download completion persists History to the isolated user-data directory");
    return { passed: checks.length, checks, serverPort: ready.port, isolatedData: dir };
  } finally {
    if (socket) socket.close();
    if (child && child.exitCode === null) {
      const exited = once(child, "exit");
      if (base && token) await fetch(base + "/shutdown", { method: "POST", headers: { "X-Server-Token": token } }).catch(() => {});
      const timeout = setTimeout(() => child.kill(), 12000);
      await exited; clearTimeout(timeout);
    }
    if (mediaServer) await new Promise(resolve => mediaServer.close(resolve));
    log.end();
  }
}

if (require.main === module) run().then(result => {
  fs.writeFileSync(path.join(os.tmpdir(), "gvl-audit-runtime-result.json"), JSON.stringify(result, null, 2));
  console.log(`Runtime checks: ${result.passed} passed`);
}).catch(error => { console.error(error); process.exitCode = 1; });

module.exports = { run };
