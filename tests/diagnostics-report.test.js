const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  collectDiagnostics,
  createRedactor,
  matchSignatures,
  parseLogEntries,
} = require("../backend/services/diagnostics-report");

const JOB = "youtube_GzIsWrEz9QA_frgj3";
const COOKIE_SECRET = "SECRETCOOKIEVALUE123";

function logLine(time, level, message) {
  return `[2026-10-25T${time}Z] [${level}] [server] ${message}`;
}

function makeFixture({ cookieExpiry }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gvl-diag-"));
  fs.mkdirSync(path.join(dir, "data"));
  fs.mkdirSync(path.join(dir, "downloads"));
  fs.writeFileSync(path.join(dir, "data", "app.log"), [
    logLine("23:23:09.767", "INFO", `[${JOB}] 🚀 Starting yt-dlp...`),
    logLine("23:23:09.768", "INFO", `[${JOB}] 📋 FULL ARGS:`),
    logLine("23:23:09.769", "INFO", '[\n  "--no-playlist",\n  "https://www.youtube.com/watch?v=GzIsWrEz9QA"\n]'),
    logLine("23:23:11.031", "INFO", `[${JOB}] 📋 YTDLP: [youtube] GzIsWrEz9QA: Downloading webpage`),
    logLine("23:23:11.500", "INFO", `[${JOB}] 📋 YTDLP: {"id": "huge json"}`),
    logLine("23:23:14.296", "INFO", "✅ yt-dlp updated successfully! 2026.08.19 → 2026.10.21"),
    logLine("23:23:17.150", "ERROR", `[${JOB}] yt-dlp failed (code 1). Error: ERROR: Error -3 while decompressing data: incorrect header check`),
  ].join("\n"));
  const cookies = path.join(dir, "cookies.txt");
  fs.writeFileSync(cookies, [
    "# Netscape HTTP Cookie File",
    `.youtube.com\tTRUE\t/\tTRUE\t${cookieExpiry}\tSID\t${COOKIE_SECRET}`,
    `.youtube.com\tTRUE\t/\tTRUE\t${cookieExpiry}\tPREF\tf6=40000000`,
  ].join("\n"));
  return { dir, cookies };
}

function context(fixture, failed) {
  return {
    appInfo: { version: "9.9.9" },
    paths: {
      logFile: path.join(fixture.dir, "data", "app.log"),
      dataRoot: fixture.dir,
      downloadDir: path.join(fixture.dir, "downloads"),
      cookiesPath: fixture.cookies,
    },
    executables: {
      ytdlp: path.join(fixture.dir, "missing-yt-dlp.exe"),
      ffmpeg: path.join(fixture.dir, "missing-ffmpeg.exe"),
      ffprobe: path.join(fixture.dir, "missing-ffprobe.exe"),
      node: path.join(fixture.dir, "missing-node.exe"),
    },
    getToolVersion: async () => "error",
    state: { failedDownloads: new Map(Object.entries(failed)) },
    probeNetwork: false,
  };
}

const failedJob = {
  [JOB]: {
    videoUrl: "https://www.youtube.com/watch?v=GzIsWrEz9QA",
    title: "ElClásico highlights",
    message: "ERROR: Error -3 while decompressing data: incorrect header check",
    failedAt: "2026-10-25T23:23:17.153Z",
    attempt: 0,
    siteKey: "youtube",
    format: "mp4",
    quality: "highest",
    settings: { smartRetry: true, downloadFolder: null },
  },
};

test("log parser attaches continuation lines to the previous entry", () => {
  const entries = parseLogEntries([
    logLine("10:00:00.000", "ERROR", "boom"),
    "    at stack (file.js:1:1)",
    logLine("10:00:01.000", "INFO", "next"),
  ].join("\r\n"));
  assert.equal(entries.length, 2);
  assert.match(entries[0].message, /boom\n {4}at stack/);
  assert.equal(entries[1].level, "INFO");
});

test("redactor hides profile path, secrets and signed URLs but keeps video page URLs", () => {
  const redact = createRedactor({ homeDir: "C:\\Users\\Alice" });
  const text = redact(
    "C:\\Users\\Alice\\x C:/Users/alice/y token=abc123 me@mail.com " +
    "https://www.youtube.com/watch?v=ID1&pp=tracking: " +
    "https://rr1.googlevideo.com/videoplayback?expire=1&sig=XYZ",
  );
  assert.doesNotMatch(text, /Alice|abc123|me@mail\.com|sig=XYZ|pp=tracking/i);
  assert.match(text, /%USERPROFILE%\\x %USERPROFILE%\/y/);
  assert.match(text, /https:\/\/www\.youtube\.com\/watch\?v=ID1: /);
  assert.match(text, /videoplayback\?<query redacted>/);
});

test("signatures recognise the common failure messages", () => {
  const ids = (message) => matchSignatures(message).map((s) => s.id);
  assert.deepEqual(ids("ERROR: Error -3 while decompressing data: incorrect header check"), ["binary-replaced"]);
  assert.ok(ids("Sign in to confirm you’re not a bot").includes("youtube-bot-check"));
  assert.ok(ids("WARNING: n challenge solving failed").includes("js-challenge"));
  assert.ok(ids("[Errno 28] No space left on device").includes("disk-full"));
  assert.deepEqual(ids("something nobody has seen"), []);
});

test("report diagnoses a binary swapped mid-download with evidence and a repro command", async () => {
  const fixture = makeFixture({ cookieExpiry: Math.floor(Date.now() / 1000) + 86400 });
  try {
    const { data, text } = await collectDiagnostics(context(fixture, failedJob));
    assert.equal(data.issues[0].id, "binary-replaced");
    assert.ok(data.issues[0].evidence.some((line) => /tool update ran while this job was active/.test(line)));
    assert.ok(!data.issues.some((issue) => issue.id === "smart-retry-skipped"), "binary swaps are retryable now");
    assert.ok(data.issues.some((issue) => issue.id === "ytdlp-broken"));
    assert.match(text, /Most likely cause of the latest failure: \*\*yt-dlp executable was replaced/);
    assert.match(text, /--no-playlist "?https:\/\/www\.youtube\.com\/watch\?v=GzIsWrEz9QA/);
    assert.match(text, /SID=valid/);
    assert.doesNotMatch(text, new RegExp(COOKIE_SECRET));
    assert.doesNotMatch(text, /huge json/, "giant metadata dumps stay out of timelines");
  } finally {
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("expired login cookies are flagged without leaking values", async () => {
  const fixture = makeFixture({ cookieExpiry: 1000 });
  try {
    const { data, text } = await collectDiagnostics(context(fixture, {}));
    assert.ok(data.issues.some((issue) => issue.id === "cookies-expired" && issue.severity === "critical"));
    assert.doesNotMatch(text, new RegExp(COOKIE_SECRET));
    assert.match(text, /Failed downloads \(0 stored/);
  } finally {
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("renderer errors and settings supplied by the window appear in the report", async () => {
  const fixture = makeFixture({ cookieExpiry: Math.floor(Date.now() / 1000) + 86400 });
  try {
    const { data, text } = await collectDiagnostics(context(fixture, {}), {
      renderer: {
        settings: { uiScale: 0.7, defaultFormat: "mp4" },
        errors: [{ type: "error", message: "TypeError: x is undefined", source: "script.js:10:5" }],
      },
    });
    assert.ok(data.issues.some((issue) => issue.id === "renderer-errors"));
    assert.match(text, /TypeError: x is undefined @ script\.js:10:5/);
    assert.match(text, /uiScale=0\.7/);
  } finally {
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("cookie health summary reports login expiry without cookie details", () => {
  const { summarizeCookieHealth } = require("../backend/services/diagnostics-report");
  const now = Date.UTC(2026, 9, 26);
  const day = 86400000;
  const base = { exists: true, validHeader: true, total: 5, modifiedAgoMs: day };
  assert.deepEqual(summarizeCookieHealth({ exists: false }, now), { status: "none" });
  assert.equal(summarizeCookieHealth({ ...base, youtubeAuth: {} }, now).status, "no-login");
  assert.equal(summarizeCookieHealth({ ...base, validHeader: false }, now).status, "invalid");

  const valid = summarizeCookieHealth({ ...base, youtubeAuth: {
    SID: { state: "valid", expiresInMs: 40 * day },
    "__Secure-1PSID": { state: "valid", expiresInMs: 30 * day },
  } }, now);
  assert.equal(valid.status, "valid");
  assert.equal(valid.expiresAt, now + 30 * day, "the first login cookie to expire ends the session");
  assert.equal(valid.importedAt, now - day);

  assert.equal(summarizeCookieHealth({ ...base, youtubeAuth: {
    SID: { state: "valid", expiresInMs: 2 * day },
  } }, now).status, "expiring");

  const expired = summarizeCookieHealth({ ...base, youtubeAuth: {
    SID: { state: "expired", expiresInMs: -3 * day },
  } }, now);
  assert.equal(expired.status, "expired");
  assert.equal(expired.expiresAt, now - 3 * day);
  assert.equal(JSON.stringify(expired).includes("SID"), false);
});
