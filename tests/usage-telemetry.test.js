const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  DEFAULT_ENDPOINT,
  MAX_BATCH,
  MAX_QUEUE,
  STATE_FILE_NAME,
  buildDownloadProps,
  buildPayload,
  createUsageTelemetry,
  describeSystem,
  durationBucket,
  platformFromUrl,
  resolveEndpoint,
  sizeBucket,
} = require("../backend/services/usage-telemetry");

const PACKAGED_ENV = Object.freeze({ GVL_APP_PACKAGED: "1" });
const SYSTEM = Object.freeze({ os: "windows", os_version: "11", arch: "x64", locale: "en" });

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gvl-usage-telemetry-"));
}

// Timers that never fire on their own; tests call flush() explicitly.
function fakeTimers() {
  let nextId = 1;
  const active = new Set();
  return {
    active,
    setTimeout: () => { const id = nextId++; active.add(id); return id; },
    clearTimeout: (id) => active.delete(id),
    setInterval: () => { const id = nextId++; active.add(id); return id; },
    clearInterval: (id) => active.delete(id),
  };
}

function fakeFetch(respond = () => ({ ok: true, status: 204 })) {
  const calls = [];
  const impl = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, options, body });
    return respond({ url, options, body, index: calls.length - 1 });
  };
  impl.calls = calls;
  return impl;
}

let uuidCounter = 0;
function nextUuid() {
  uuidCounter += 1;
  return `00000000-0000-4000-8000-${String(uuidCounter).padStart(12, "0")}`;
}

function createClient(overrides = {}) {
  const userDataPath = overrides.userDataPath || tempDir();
  const timers = overrides.timers || fakeTimers();
  const fetchImpl = overrides.fetchImpl || fakeFetch();
  const client = createUsageTelemetry({
    userDataPath,
    appVersion: "3.3.0",
    env: PACKAGED_ENV,
    fetchImpl,
    timers,
    system: SYSTEM,
    channel: "installer",
    randomUUID: nextUuid,
    logger: { warn() {}, log() {}, error() {} },
    ...overrides,
  });
  return { client, userDataPath, timers, fetchImpl, statePath: path.join(userDataPath, STATE_FILE_NAME) };
}

test("platform bucketing uses only the hostname and falls back to other", () => {
  assert.equal(platformFromUrl("https://www.youtube.com/watch?v=abc"), "youtube");
  assert.equal(platformFromUrl("https://youtu.be/abc"), "youtube");
  assert.equal(platformFromUrl("https://music.youtube.com/watch?v=abc"), "youtube");
  assert.equal(platformFromUrl("https://vm.tiktok.com/xyz"), "tiktok");
  assert.equal(platformFromUrl("https://twitter.com/a/status/1"), "x");
  assert.equal(platformFromUrl("https://x.com/a/status/1"), "x");
  assert.equal(platformFromUrl("https://fb.watch/abc"), "facebook");
  assert.equal(platformFromUrl("https://old.reddit.com/r/x"), "reddit");
  assert.equal(platformFromUrl("https://clips.twitch.tv/x"), "twitch");
  assert.equal(platformFromUrl("https://notyoutube.com/watch"), "other");
  assert.equal(platformFromUrl("https://youtube.com.evil.example/watch"), "other");
  assert.equal(platformFromUrl("not a url"), "other");
  assert.equal(platformFromUrl(undefined), "other");
});

test("buckets are coarse and download props never include the URL", () => {
  assert.equal(durationBucket(30), "under_1m");
  assert.equal(durationBucket(600), "5_20m");
  assert.equal(durationBucket(7200), "over_60m");
  assert.equal(durationBucket(null), null);
  assert.equal(sizeBucket(5 * 1024 * 1024), "under_10mb");
  assert.equal(sizeBucket(2 * 1024 * 1024 * 1024), "over_1gb");

  const url = "https://www.youtube.com/watch?v=secret-id&list=private";
  const success = buildDownloadProps({ result: "success", url, format: "mp3", durationSeconds: 200, sizeBytes: 50 * 1024 * 1024 });
  assert.deepEqual(success, {
    result: "success",
    media: "audio",
    in_playlist: false,
    platform: "youtube",
    duration_bucket: "1_5m",
    size_bucket: "10_100mb",
  });

  const failed = buildDownloadProps({ result: "failed", url, format: "mp4", isPlaylistItem: true, errorCategory: "rate_limit", sizeBytes: 999 });
  assert.equal(failed.error_category, "rate_limit");
  assert.equal(failed.in_playlist, true);
  assert.equal(failed.size_bucket, undefined);
  assert.equal(buildDownloadProps({ result: "failed", url, errorCategory: "C:\\Users\\me" }).error_category, "unknown");
  assert.equal(buildDownloadProps({ result: "cancelled", url }).error_category, undefined);
  assert.equal(buildDownloadProps({ result: "exploded", url }), null);

  const payload = buildPayload({
    installId: "00000000-0000-4000-8000-000000000001",
    appVersion: "3.3.0",
    channel: "portable",
    events: [{ name: "download_finished", at: "2026-10-04T00:00:00.000Z", v: "3.3.0", props: success }],
  });
  assert.deepEqual(Object.keys(payload), ["install_id", "app_version", "channel", "events"]);
  assert.deepEqual(Object.keys(payload.events[0]), ["name", "at", "props"]);
  assert.doesNotMatch(JSON.stringify(payload), /secret-id|private|watch\?/);
});

test("system description keeps only coarse values", () => {
  assert.deepEqual(
    describeSystem({ platform: "win32", release: "10.0.26100", arch: "x64", locale: "nl-BE" }),
    { os: "windows", os_version: "11", arch: "x64", locale: "nl" },
  );
  assert.deepEqual(
    describeSystem({ platform: "win32", release: "10.0.19045", arch: "arm64", locale: "en_US" }),
    { os: "windows", os_version: "10", arch: "arm64", locale: "en" },
  );
  assert.equal(describeSystem({ platform: "freebsd", release: "14", arch: "riscv64", locale: "x" }).os, "other");
});

test("endpoint resolution: kill switch, dev builds and loopback-only override", () => {
  assert.equal(resolveEndpoint({ GVL_APP_PACKAGED: "1" }).endpoint, DEFAULT_ENDPOINT);
  for (const value of ["0", "false", "off", "OFF", "no"]) {
    assert.equal(resolveEndpoint({ GVL_APP_PACKAGED: "1", GVL_TELEMETRY: value }).endpoint, null);
  }
  assert.deepEqual(resolveEndpoint({}), { endpoint: null, reason: "development_build" });
  assert.deepEqual(resolveEndpoint({ GVL_APP_PACKAGED: "0" }), { endpoint: null, reason: "development_build" });
  assert.equal(
    resolveEndpoint({ GVL_TELEMETRY_ENDPOINT: "http://127.0.0.1:3000/api/app/telemetry" }).endpoint,
    "http://127.0.0.1:3000/api/app/telemetry",
  );
  assert.equal(resolveEndpoint({ GVL_TELEMETRY_ENDPOINT: "http://localhost:5173/api/app/telemetry" }).reason, "local_endpoint");
  assert.equal(resolveEndpoint({ GVL_APP_PACKAGED: "1", GVL_TELEMETRY_ENDPOINT: "https://evil.example/collect" }).endpoint, null);
});

test("off by default: nothing is recorded, stored or sent", async () => {
  const { client, fetchImpl, statePath } = createClient();
  await client.init();
  assert.equal(client.getStatus().enabled, false);
  assert.equal(client.recordDownloadFinished({ result: "success", url: "https://youtu.be/x" }), false);
  await client.flush();
  await client.shutdown();
  assert.equal(fetchImpl.calls.length, 0);
  assert.equal(fs.existsSync(statePath), false);
});

test("dev builds and the kill switch never send even after opting in", async () => {
  for (const env of [{}, { GVL_APP_PACKAGED: "1", GVL_TELEMETRY: "0" }]) {
    const { client, fetchImpl } = createClient({ env });
    await client.init();
    const status = await client.setEnabled(true);
    assert.equal(status.enabled, true);
    assert.equal(status.available, false);
    client.recordDownloadFinished({ result: "success", url: "https://youtu.be/x" });
    await client.flush({ ignoreBackoff: true });
    await client.shutdown();
    assert.equal(fetchImpl.calls.length, 0);
    assert.equal(client._getState().queue.length, 0);
  }
});

test("opting in records a launch and sends a minimal payload", async () => {
  const { client, fetchImpl, statePath } = createClient();
  await client.init();
  await client.setEnabled(true);
  client.recordDownloadFinished({
    result: "failed",
    url: "https://www.instagram.com/reel/private-code/",
    format: "mp4",
    errorCategory: "cookies",
    durationSeconds: 45,
  });
  assert.equal(fs.existsSync(statePath), true);
  await client.flush();

  assert.equal(fetchImpl.calls.length, 1);
  const { url, options, body } = fetchImpl.calls[0];
  assert.equal(url, DEFAULT_ENDPOINT);
  assert.equal(options.method, "POST");
  assert.match(body.install_id, /^[0-9a-f-]{36}$/);
  assert.equal(body.app_version, "3.3.0");
  assert.equal(body.channel, "installer");
  assert.deepEqual(body.events.map((event) => event.name), ["app_open", "download_finished"]);
  assert.deepEqual(body.events[0].props, SYSTEM);
  assert.deepEqual(body.events[1].props, {
    result: "failed",
    media: "video",
    in_playlist: false,
    platform: "instagram",
    error_category: "cookies",
    duration_bucket: "under_1m",
  });
  assert.doesNotMatch(options.body, /instagram\.com|private-code|reel/);
  assert.equal(client._getState().queue.length, 0);
  await client.shutdown();
});

test("opting out clears the queue, deletes the file and aborts an in-flight request", async () => {
  let release;
  let aborted = false;
  const fetchImpl = fakeFetch(({ options }) => new Promise((resolve, reject) => {
    options.signal.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); });
    release = () => resolve({ ok: true, status: 204 });
  }));
  const { client, statePath, timers } = createClient({ fetchImpl });
  await client.init();
  await client.setEnabled(true);
  const firstId = client._getState().installId;
  assert.equal(fs.existsSync(statePath), true);

  const flushing = client.flush();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fetchImpl.calls.length, 1);

  await client.setEnabled(false);
  await flushing;
  assert.equal(aborted, true);
  assert.equal(client._getState().queue.length, 0);
  assert.equal(client._getState().installId, null);
  assert.equal(fs.existsSync(statePath), false);
  assert.equal(fs.existsSync(`${statePath}.bak`), false);
  assert.equal(timers.active.size, 0);
  assert.equal(client.recordDownloadFinished({ result: "success", url: "https://youtu.be/x" }), false);
  if (release) release();

  // Opting back in creates a fresh random install ID.
  await client.setEnabled(true);
  assert.notEqual(client._getState().installId, firstId);
  await client.setEnabled(false);
  await client.shutdown();
});

test("a new app version on launch records app_update from the last seen version", async () => {
  const userDataPath = tempDir();
  // The old version goes offline before it can deliver its launch event.
  const first = createClient({ userDataPath, appVersion: "3.2.6", fetchImpl: fakeFetch(() => ({ ok: false, status: 503 })) });
  await first.client.init();
  await first.client.setEnabled(true);
  await first.client.shutdown();

  const fetchImpl = fakeFetch();
  const second = createClient({ userDataPath, appVersion: "3.3.0", fetchImpl });
  await second.client.init();
  const names = second.client._getState().queue.map((event) => `${event.name}@${event.v}`);
  assert.deepEqual(names, ["app_open@3.2.6", "app_update@3.3.0", "app_open@3.3.0"]);
  const update = second.client._getState().queue[1];
  assert.deepEqual(update.props, { from_version: "3.2.6", to_version: "3.3.0" });

  // Batches never mix versions, so the old launch is reported as 3.2.6.
  await second.client.flush();
  assert.deepEqual(fetchImpl.calls.map((call) => call.body.app_version), ["3.2.6", "3.3.0"]);
  assert.equal(fetchImpl.calls[0].body.install_id, fetchImpl.calls[1].body.install_id);
  await second.client.shutdown();
});

test("batches are capped, the queue is bounded and failures back off", async () => {
  let clock = Date.parse("2026-10-04T12:00:00Z");
  let failNext = 1;
  const fetchImpl = fakeFetch(() => {
    if (failNext > 0) {
      failNext -= 1;
      return { ok: false, status: 503 };
    }
    return { ok: true, status: 204 };
  });
  const { client } = createClient({ fetchImpl, now: () => clock });
  await client.init();
  await client.setEnabled(true);
  for (let index = 0; index < MAX_QUEUE + 25; index += 1) {
    client.recordDownloadFinished({ result: "success", url: "https://vimeo.com/1" });
  }
  assert.equal(client._getState().queue.length, MAX_QUEUE);

  await client.flush();
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(client._getState().queue.length, MAX_QUEUE);

  // Still backing off: no request.
  clock += 30 * 1000;
  await client.flush();
  assert.equal(fetchImpl.calls.length, 1);

  clock += 60 * 1000;
  await client.flush();
  assert.equal(client._getState().queue.length, 0);
  const sizes = fetchImpl.calls.slice(1).map((call) => call.body.events.length);
  assert.ok(sizes.every((size) => size <= MAX_BATCH));
  assert.equal(sizes.reduce((sum, size) => sum + size, 0), MAX_QUEUE);
  await client.shutdown();
});

test("rejected batches are dropped and network errors are swallowed", async () => {
  const rejecting = createClient({ fetchImpl: fakeFetch(() => ({ ok: false, status: 400 })) });
  await rejecting.client.init();
  await rejecting.client.setEnabled(true);
  await rejecting.client.flush();
  assert.equal(rejecting.client._getState().queue.length, 0);
  await rejecting.client.shutdown();

  const throwing = createClient({ fetchImpl: async () => { throw new Error("offline"); } });
  await throwing.client.init();
  await throwing.client.setEnabled(true);
  await assert.doesNotReject(throwing.client.flush());
  assert.equal(throwing.client._getState().queue.length, 1);
  await assert.doesNotReject(throwing.client.shutdown());
});

test("a corrupt or foreign state file is treated as opted out", async () => {
  const userDataPath = tempDir();
  const statePath = path.join(userDataPath, STATE_FILE_NAME);
  fs.writeFileSync(statePath, "{not json");
  const corrupt = createClient({ userDataPath });
  await corrupt.client.init();
  assert.equal(corrupt.client.getStatus().enabled, false);

  fs.writeFileSync(statePath, JSON.stringify({ enabled: true, installId: "me@example.com", queue: [] }));
  const foreign = createClient({ userDataPath });
  await foreign.client.init();
  assert.equal(foreign.client.getStatus().enabled, false);
});
