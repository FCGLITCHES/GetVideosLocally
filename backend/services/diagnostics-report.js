"use strict";

// Builds the "Generate Diagnostics Bundle" report.
//
// The report is meant to be self-sufficient: someone reading only this file
// should see what failed, the evidence behind it, the likely cause and where
// to fix it, without needing to ask the user for logs or reproduction steps.

const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");
const { execFile } = require("child_process");
const { classifyRuntimeError } = require("./error-classifier");

const REPORT_SCHEMA = 2;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_FAILED_JOBS = 10;
const MAX_TIMELINE_LINES = 80;
const MAX_LINE_CHARS = 420;
const YTDLP_STALE_DAYS = 45;
const LOW_DISK_BYTES = 2 * 1024 ** 3;
const CRITICAL_DISK_BYTES = 512 * 1024 ** 2;
const YOUTUBE_AUTH_COOKIES = [
  "SID", "HSID", "SSID", "APISID", "SAPISID", "LOGIN_INFO",
  "__Secure-1PSID", "__Secure-3PSID",
];
const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 };

// Known failure signatures. `match` runs against the error message plus the
// yt-dlp output captured for the job; the first matching signature wins for
// "primary cause", but every match is reported.
const SIGNATURES = [
  {
    id: "binary-replaced",
    severity: "critical",
    pattern: /decompressing data|incorrect header check|bad magic number|pyz archive|zipimport/i,
    title: "yt-dlp executable was replaced or corrupted while it was running",
    cause:
      "yt-dlp.exe is a PyInstaller one-file build that keeps reading compressed modules from its own exe. " +
      "If the binary is swapped (yt-dlp -U auto-update, antivirus quarantine/restore, or a partial download) " +
      "while a job runs, the live process reads garbage and dies with a zlib error.",
    fix:
      "Make sure tool updates never overlap running yt-dlp/ffmpeg processes (backend/utils/tool-update-gate.js). " +
      "If no update overlapped the job, check antivirus logs and re-verify the yt-dlp.exe checksum.",
    workaround: "Retry the download; it succeeds once the new binary is in place.",
  },
  {
    id: "youtube-bot-check",
    severity: "critical",
    pattern: /sign in to confirm you.?re not a bot|confirm you.?re not a robot/i,
    title: "YouTube is demanding sign-in (bot check)",
    cause: "YouTube flagged the request as automated. This happens with no cookies, expired cookies, or a flagged IP.",
    fix:
      "Check the Cookies section below. If login cookies are missing or expired, the cookie import/refresh flow " +
      "is the place to fix. If cookies are fresh, the IP may be flagged; reduce request rate (pacing profile).",
    workaround: "Re-import YouTube cookies from a signed-in browser, then retry.",
  },
  {
    id: "cookies-rejected",
    severity: "critical",
    pattern: /cookies may be expired|cookie(?:s)? (?:are |is )?invalid|invalid netscape format|cookiejar\.loaderror|no valid cookies/i,
    title: "Cookies were rejected or could not be loaded",
    cause: "The cookies file is expired, malformed, or from a signed-out session.",
    fix: "Validate the cookies file (see Cookies section); the import path should reject files without login cookies.",
    workaround: "Re-import cookies from a browser where you are signed in.",
  },
  {
    id: "js-challenge",
    severity: "critical",
    pattern: /n challenge solving failed|signature solving failed|js runtimes: none|challenge solver|no supported javascript runtime/i,
    title: "yt-dlp could not solve YouTube's JavaScript challenge",
    cause:
      "YouTube stream URLs need a JS runtime (bundled node.exe via --js-runtimes) plus the yt-dlp EJS solver. " +
      "Missing/unreadable node.exe, a wrong path, or an outdated yt-dlp breaks this and leaves only storyboard images.",
    fix: "Check the JavaScript runtime line in Tools. Ensure --js-runtimes points at an existing node.exe and yt-dlp is current.",
    workaround: "Update tools (Settings > Update Tools), then retry.",
  },
  {
    id: "no-formats",
    severity: "warning",
    pattern: /only images are available|requested format is not available|sabr/i,
    title: "No downloadable video formats were returned",
    cause:
      "Usually a side effect of a failed JS challenge or YouTube's SABR-only streaming experiment for this account/client.",
    fix: "Look for a js-challenge issue first. Otherwise update yt-dlp; SABR handling changes frequently upstream.",
    workaround: "Update tools and retry; try without cookies if only the signed-in session is affected.",
  },
  {
    id: "stream-forbidden",
    severity: "warning",
    pattern: /http error 403|403: forbidden|media stream was refused/i,
    title: "Media server refused the stream (HTTP 403)",
    cause: "Expired stream URL, missing PO token, or IP/session mismatch between extraction and download.",
    fix: "Update yt-dlp. If persistent, check that extraction and download use the same cookies and user agent.",
    workaround: "Retry; update tools if it keeps happening.",
  },
  {
    id: "rate-limited",
    severity: "warning",
    pattern: /http error 429|too many requests|rate.?limit|yt_circuit_open|circuit is open/i,
    title: "Site is rate-limiting requests",
    cause: "Too many requests in a short time from this IP/session.",
    fix: "Check pacing profile and concurrency in Settings; the circuit breaker should back off.",
    workaround: "Wait 15-60 minutes, lower concurrency, then retry.",
  },
  {
    id: "content-unavailable",
    severity: "info",
    pattern: /private video|video unavailable|this video is not available|has been removed|members.only|confirm your age|age.restricted|premieres in|live event will begin/i,
    title: "The video itself is unavailable, private, members-only, or age-restricted",
    cause: "Content restriction on the site, not an app defect.",
    fix: "None in the app unless the restriction is age-gating that cookies should satisfy.",
    workaround: "Use cookies from an account that can watch it, or choose another video.",
  },
  {
    id: "geo-blocked",
    severity: "info",
    pattern: /not available in your country|geo.?restrict|blocked it in your country/i,
    title: "Video is geo-blocked",
    cause: "Regional restriction by the uploader or site.",
    fix: "Not an app defect.",
    workaround: "Not downloadable from this region.",
  },
  {
    id: "network",
    severity: "warning",
    pattern: /timed out|getaddrinfo|enotfound|econnreset|econnrefused|network is unreachable|unable to download webpage|certificate_verify_failed|ssl:|did not get any data blocks|connection reset/i,
    title: "Network failure while talking to the site",
    cause: "DNS, connectivity, proxy/VPN, TLS interception, or a site outage.",
    fix: "Compare with the Network section below. If connectivity is fine, check proxy/antivirus TLS inspection.",
    workaround: "Check the connection or VPN and retry.",
  },
  {
    id: "ffmpeg-failed",
    severity: "warning",
    pattern: /ffmpeg (?:not found|exited|conversion failed)|ffprobe and ffmpeg not found|postprocessing:|conversion failed|error opening output|invalid data found when processing input/i,
    title: "FFmpeg failed while merging or converting",
    cause: "Missing/broken ffmpeg, unsupported codec/container combination, or a truncated input file.",
    fix: "Check FFmpeg in Tools; reproduce with the command in the failed download's dossier.",
    workaround: "Try a different format/quality (e.g. MP4 instead of the current selection).",
  },
  {
    id: "disk-full",
    severity: "critical",
    pattern: /no space left|enospc|disk (?:is )?full|not enough space/i,
    title: "Disk is full",
    cause: "The download folder's drive ran out of space.",
    fix: "See Storage section; the app should check free space before starting large downloads.",
    workaround: "Free up space or change the download folder.",
  },
  {
    id: "file-access",
    severity: "warning",
    pattern: /eperm|eacces|permission denied|being used by another process|winerror 32|winerror 5\b|access is denied/i,
    title: "File access was denied",
    cause: "Folder not writable, file locked by another program (player, antivirus, cloud sync), or protected location.",
    fix: "See Storage section (writable check). Consider retrying renames when files are briefly locked.",
    workaround: "Close programs using the file, or pick a different download folder.",
  },
  {
    id: "bad-filename",
    severity: "warning",
    pattern: /file name too long|winerror 123|winerror 206|invalid argument.*\.part/i,
    title: "Output filename/path is invalid or too long",
    cause: "Title produced an invalid Windows path or exceeded path length limits.",
    fix: "Tighten filename sanitising/truncation in download-runner sanitizeFilename.",
    workaround: "Choose a shorter download folder path.",
  },
  {
    id: "unsupported-url",
    severity: "info",
    pattern: /unsupported url|no suitable infoextractor/i,
    title: "URL is not supported",
    cause: "yt-dlp has no extractor for this site or URL shape.",
    fix: "Not an app defect unless the site is listed as supported.",
    workaround: "Use the direct video page URL.",
  },
  {
    id: "extractor-broken",
    severity: "warning",
    pattern: /unable to extract|failed to parse json|please report this issue|keyerror|indexerror|traceback \(most recent call last\)/i,
    title: "yt-dlp extractor crashed (site changed)",
    cause: "The site changed its page/API and this yt-dlp version cannot parse it.",
    fix: "Update yt-dlp. If already latest, it is an upstream yt-dlp bug.",
    workaround: "Update tools and retry later.",
  },
  {
    id: "tool-launch",
    severity: "critical",
    pattern: /process failed to start|spawn .*enoent|is not recognized as an internal|no such option|unrecognized arguments/i,
    title: "A tool failed to launch or rejected its arguments",
    cause: "Missing executable, wrong path, or an argument this tool version does not support.",
    fix: "Check Tools paths below and compare the reproduce command against the installed yt-dlp version.",
    workaround: "Reinstall the app to restore bundled tools.",
  },
];

// ==================== HELPERS ====================

function truncate(text, max = MAX_LINE_CHARS) {
  const value = String(text ?? "");
  return value.length > max ? `${value.slice(0, max)}… (+${value.length - max} chars)` : value;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "unknown";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatAge(ms) {
  if (!Number.isFinite(ms)) return "unknown";
  const abs = Math.abs(ms);
  if (abs < 60 * 1000) return `${Math.round(abs / 1000)}s`;
  if (abs < 60 * 60 * 1000) return `${Math.round(abs / 60000)}m`;
  if (abs < DAY_MS) return `${(abs / 3600000).toFixed(1)}h`;
  return `${(abs / DAY_MS).toFixed(1)}d`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Redacts secrets and the user's profile path. Page URLs stay (they are
// needed to reproduce), but signed media/CDN query strings are dropped.
function createRedactor({ homeDir = os.homedir() } = {}) {
  const homeVariants = homeDir
    ? [...new Set([homeDir, homeDir.replace(/\\/g, "/"), homeDir.replace(/\\/g, "\\\\")])]
    : [];
  const homePattern = homeVariants.length
    ? new RegExp(homeVariants.map(escapeRegExp).join("|"), "gi")
    : null;

  function redactUrl(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return url;
    }
    const host = parsed.hostname.replace(/^www\./, "");
    const isPage = /(^|\.)(youtube\.com|youtu\.be)$/.test(host) && !/^\/(sb|vi|s\/player)\//.test(parsed.pathname);
    if (isPage) {
      const kept = new URLSearchParams();
      for (const key of ["v", "list", "index", "t"]) {
        if (parsed.searchParams.has(key)) kept.set(key, parsed.searchParams.get(key));
      }
      const query = kept.toString();
      return `${parsed.origin}${parsed.pathname}${query ? `?${query}` : ""}`;
    }
    return parsed.search ? `${parsed.origin}${parsed.pathname}?<query redacted>` : url;
  }

  return function redact(text) {
    let value = String(text ?? "");
    value = value.replace(/https?:\/\/[^\s"'<>)\]]+/g, (match) => {
      // Sentence punctuation right after a URL is not part of it.
      const trailing = match.match(/[.,:;!?]+$/)?.[0] || "";
      return redactUrl(match.slice(0, match.length - trailing.length)) + trailing;
    });
    value = value.replace(
      /\b(token|access_token|api[_-]?key|key|sig|signature|password|passwd|secret|auth|authorization|cookie|x-server-token)(["']?\s*[:=]\s*["']?)([^\s"'&,;]+)/gi,
      "$1$2<redacted>",
    );
    value = value.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer <redacted>");
    value = value.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email>");
    if (homePattern) value = value.replace(homePattern, "%USERPROFILE%");
    return value;
  };
}

// Parses "[ISO] [LEVEL] [context] message" log lines; continuation lines
// (stack traces, pretty-printed JSON) are attached to the previous entry.
function parseLogEntries(text) {
  const entries = [];
  const linePattern = /^\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\] \[(DEBUG|INFO|WARN|ERROR)\] (?:\[([\w.-]+)\] )?(.*)$/;
  for (const line of String(text || "").split(/\r?\n/)) {
    const match = line.match(linePattern);
    if (match) {
      entries.push({
        time: Date.parse(match[1]),
        timestamp: match[1],
        level: match[2],
        context: match[3] || "",
        message: match[4],
      });
    } else if (entries.length && line.length) {
      entries[entries.length - 1].message += `\n${line}`;
    }
  }
  return entries;
}

async function readLogEntries(logFile) {
  const files = [`${logFile}.2`, `${logFile}.1`, logFile];
  const entries = [];
  const sources = [];
  for (const file of files) {
    try {
      const text = await fs.promises.readFile(file, "utf8");
      const parsed = parseLogEntries(text);
      entries.push(...parsed);
      sources.push({ file, entries: parsed.length, bytes: Buffer.byteLength(text) });
    } catch (error) {
      if (error.code !== "ENOENT") sources.push({ file, error: error.message });
    }
  }
  entries.sort((a, b) => a.time - b.time);
  return { entries, sources };
}

function matchSignatures(text) {
  return SIGNATURES.filter((signature) => signature.pattern.test(text));
}

function normalizeErrorMessage(message) {
  return String(message || "")
    .split("\n")[0]
    .replace(/\[[a-z]+_[A-Za-z0-9_-]+\]/g, "[job]")
    .replace(/\[(youtube|generic|[a-z]+)\] [A-Za-z0-9_-]{6,}:/g, "[$1] <id>:")
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/\b\d+(\.\d+)*\b/g, "N")
    .slice(0, 220);
}

function runProbe(executable, args, timeout = 15000) {
  return new Promise((resolve) => {
    if (!executable) return resolve({ ok: false, error: "not configured" });
    const started = Date.now();
    execFile(executable, args, { timeout, windowsHide: true }, (error, stdout, stderr) => {
      const output = `${stdout || ""}${stderr || ""}`.trim();
      resolve({
        ok: !error,
        output: output.split(/\r?\n/)[0] || "",
        error: error ? error.message : null,
        ms: Date.now() - started,
      });
    });
  });
}

function probeUrl(url, timeout = 6000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const request = https.request(url, { method: "HEAD", timeout }, (response) => {
      response.resume();
      resolve({ url, ok: response.statusCode < 500, status: response.statusCode, ms: Date.now() - started });
    });
    request.on("timeout", () => request.destroy(new Error(`timed out after ${timeout} ms`)));
    request.on("error", (error) => resolve({ url, ok: false, error: error.message, ms: Date.now() - started }));
    request.end();
  });
}

async function statSafe(target) {
  try {
    return await fs.promises.stat(target);
  } catch {
    return null;
  }
}

async function checkWritable(directory) {
  const probe = path.join(directory, `.gvl-write-test-${process.pid}-${Date.now()}`);
  try {
    await fs.promises.writeFile(probe, "ok");
    await fs.promises.unlink(probe);
    return { writable: true };
  } catch (error) {
    return { writable: false, error: error.code || error.message };
  }
}

async function diskFree(directory) {
  try {
    const stats = await fs.promises.statfs(directory);
    return { free: stats.bavail * stats.bsize, total: stats.blocks * stats.bsize };
  } catch (error) {
    return { error: error.code || error.message };
  }
}

function parseYtDlpVersionDate(version) {
  const match = String(version || "").match(/(\d{4})\.(\d{2})\.(\d{2})/);
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
}

async function inspectCookies(cookiesPath, now) {
  const result = { path: cookiesPath, exists: false };
  const stats = cookiesPath ? await statSafe(cookiesPath) : null;
  if (!stats) return result;
  result.exists = true;
  result.size = stats.size;
  result.modifiedAgoMs = now - stats.mtimeMs;
  try {
    const text = await fs.promises.readFile(cookiesPath, "utf8");
    const lines = text.replace(/^﻿/, "").split(/\r?\n/);
    result.validHeader = /^# (?:Netscape )?HTTP Cookie File\b/.test(lines[0] || "");
    const rows = lines
      .filter((line) => line.trim() && (!line.startsWith("#") || line.startsWith("#HttpOnly_")))
      .map((line) => line.replace(/^#HttpOnly_/, "").split("\t"));
    result.total = rows.length;
    result.malformed = rows.filter((fields) => fields.length !== 7).length;
    const domains = {};
    const auth = {};
    const nowSec = now / 1000;
    for (const fields of rows) {
      if (fields.length !== 7) continue;
      const [domain, , , , expires, name] = fields;
      const site = domain.replace(/^\./, "");
      domains[site] = (domains[site] || 0) + 1;
      if (/(^|\.)youtube\.com$|(^|\.)google\.com$/.test(site) && YOUTUBE_AUTH_COOKIES.includes(name)) {
        const expiry = Number(expires);
        const state = expiry === 0 ? "session" : expiry < nowSec ? "expired" : "valid";
        const previous = auth[name];
        if (!previous || previous.state !== "valid") {
          auth[name] = { state, expiresInMs: expiry ? expiry * 1000 - now : null };
        }
      }
    }
    result.topDomains = Object.entries(domains).sort((a, b) => b[1] - a[1]).slice(0, 8);
    result.youtubeAuth = auth;
  } catch (error) {
    result.readError = error.message;
  }
  return result;
}

// Cookies that keep a YouTube login alive. When the first of these expires
// the session is gone, so it sets the expiry date shown to the user.
const LOGIN_SESSION_COOKIES = ["SID", "__Secure-1PSID", "__Secure-3PSID", "LOGIN_INFO"];
const COOKIE_EXPIRY_WARNING_MS = 3 * 24 * 60 * 60 * 1000;

// Plain-language cookie state for the settings screen and expiry warning.
// status: none | invalid | no-login | session | valid | expiring | expired
function summarizeCookieHealth(inspection, now = Date.now()) {
  if (!inspection?.exists) return { status: "none" };
  const importedAt = inspection.modifiedAgoMs != null ? now - inspection.modifiedAgoMs : null;
  if (inspection.readError || inspection.validHeader === false || !inspection.total) {
    return { status: "invalid", importedAt };
  }
  const login = LOGIN_SESSION_COOKIES
    .map((name) => inspection.youtubeAuth?.[name])
    .filter(Boolean);
  if (!login.length) return { status: "no-login", importedAt };
  const valid = login.filter((cookie) => cookie.state === "valid");
  if (!valid.length) {
    if (login.some((cookie) => cookie.state === "session")) return { status: "session", importedAt };
    const expiredAgoMs = Math.min(...login.map((cookie) => -(cookie.expiresInMs ?? 0)));
    return { status: "expired", importedAt, expiresAt: now - expiredAgoMs };
  }
  const expiresInMs = Math.min(...valid.map((cookie) => cookie.expiresInMs));
  return {
    status: expiresInMs <= COOKIE_EXPIRY_WARNING_MS ? "expiring" : "valid",
    importedAt,
    expiresAt: now + expiresInMs,
  };
}

function mapValues(map) {
  if (!map) return [];
  if (typeof map.entries === "function") return [...map.entries()];
  return Object.entries(map);
}

// ==================== JOB DOSSIERS ====================

function findJobEntries(entries, jobId) {
  const tag = `[${jobId}]`;
  return entries.filter((entry) => entry.message.includes(tag));
}

function extractReproArgs(entries, jobId) {
  const marker = `[${jobId}] 📋 FULL ARGS:`;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (!entries[index].message.includes(marker)) continue;
    const next = entries[index + 1];
    if (!next) return null;
    try {
      const args = JSON.parse(next.message);
      return Array.isArray(args) ? args : null;
    } catch {
      return null;
    }
  }
  return null;
}

function quoteArg(arg) {
  const value = String(arg);
  return /[\s"&|<>^*?]/.test(value) || value === "" ? `"${value.replace(/"/g, '\\"')}"` : value;
}

const CONCURRENT_EVENT_PATTERN =
  /updated successfully|checking .* for updates|update available|download\/install failed|starting tool updates|tool update|shutdown|server running|forcing exit|client disconnected|uncaught|unhandled/i;

function buildTimeline(entries, jobId, windowStart, windowEnd) {
  const tag = `[${jobId}]`;
  const lines = [];
  for (const entry of entries) {
    if (entry.time < windowStart - 2000 || entry.time > windowEnd + 2000) continue;
    const own = entry.message.includes(tag);
    const otherJob = !own && /\[[a-z]+_[A-Za-z0-9_-]+\]/.test(entry.message);
    const concurrent =
      !own && !otherJob && (entry.level === "ERROR" || entry.level === "WARN" || CONCURRENT_EVENT_PATTERN.test(entry.message));
    if (!own && !concurrent && !(otherJob && entry.level === "ERROR")) continue;
    if (/YTDLP: \{/.test(entry.message) || /FULL ARGS|Full video args/.test(entry.message)) continue;
    const firstLine = entry.message.split("\n")[0].replace(tag, "").trim();
    if (/^=+[^=]*=*$/.test(firstLine)) continue; // "===== DEBUG =====" log banners
    const marker = own ? " " : otherJob ? "~" : "!";
    lines.push(`${entry.timestamp.slice(11, 23)} ${marker} ${entry.level.padEnd(5)} ${firstLine}`);
  }
  if (lines.length > MAX_TIMELINE_LINES) {
    const head = lines.slice(0, 20);
    const tail = lines.slice(-(MAX_TIMELINE_LINES - 21));
    return [...head, `… ${lines.length - head.length - tail.length} lines omitted …`, ...tail];
  }
  return lines;
}

function analyzeFailedJob({ jobId, job, entries, cookiesPresent }) {
  const jobEntries = findJobEntries(entries, jobId);
  const failedAt = Date.parse(job.failedAt || "") || (jobEntries.at(-1)?.time ?? Date.now());
  const startedAt = jobEntries[0]?.time ?? failedAt;
  const ytdlpOutput = jobEntries
    .filter((entry) => /YTDLP: (?!\{)|WARNING|ERROR/.test(entry.message))
    .map((entry) => entry.message.split("\n")[0])
    .join("\n");
  const errorText = `${job.message || ""}\n${ytdlpOutput}`;
  const signatures = matchSignatures(errorText);
  const primary = matchSignatures(String(job.message || ""))[0] || signatures[0] || null;
  const classification = classifyRuntimeError({
    message: job.message,
    hasCookies: cookiesPresent,
    siteKey: job.siteKey || job.source || "generic",
  });

  const overlappingUpdates = entries.filter(
    (entry) =>
      entry.time >= startedAt &&
      entry.time <= failedAt &&
      /yt-dlp updated successfully|ffmpeg (?:updated|installed) successfully/i.test(entry.message),
  );

  const warnings = [...new Set(
    jobEntries
      .map((entry) => entry.message.split("\n")[0])
      .filter((message) => /WARNING:/.test(message))
      .map((message) => message.replace(/^.*?WARNING:/, "WARNING:").trim()),
  )];

  return {
    jobId,
    title: job.title || job.itemData?.title || "(untitled)",
    url: job.videoUrl || job.url || job.itemData?.videoUrl || null,
    site: job.siteKey || job.source || "unknown",
    format: job.format,
    quality: job.quality,
    playlistAction: job.playlistAction,
    failedAt,
    startedAt,
    attempt: job.attempt ?? 0,
    message: job.message || "(no error message stored)",
    settings: job.settings || null,
    classification,
    signatures,
    primary,
    overlappingUpdates,
    warnings,
    reproArgs: extractReproArgs(entries, jobId),
    timeline: buildTimeline(entries, jobId, startedAt, failedAt),
    hasLogEvidence: jobEntries.length > 0,
  };
}

// Failures that are in the log but no longer in failed_jobs.json (dismissed,
// retried, or from older sessions).
function findLoggedFailures(entries, knownJobIds, now) {
  const failures = new Map();
  for (const entry of entries) {
    if (entry.level !== "ERROR" || now - entry.time > 7 * DAY_MS) continue;
    const match = entry.message.match(/^\[([a-z]+_[A-Za-z0-9_-]+)\] yt-dlp failed \(code (-?\d+)\)\. Error: (.*)/);
    if (!match || knownJobIds.has(match[1])) continue;
    failures.set(match[1], { jobId: match[1], time: entry.time, code: match[2], message: match[3].split("\n")[0] });
  }
  return [...failures.values()].sort((a, b) => b.time - a.time).slice(0, 8);
}

function groupRecentErrors(entries, now) {
  const groups = new Map();
  for (const entry of entries) {
    if ((entry.level !== "ERROR" && entry.level !== "WARN") || now - entry.time > 7 * DAY_MS) continue;
    if (/^\[[a-z]+_[A-Za-z0-9_-]+\] Error in processVideo/.test(entry.message)) continue; // duplicate of "yt-dlp failed"
    const key = `${entry.level} ${normalizeErrorMessage(entry.message)}`;
    const group = groups.get(key) || { level: entry.level, message: normalizeErrorMessage(entry.message), count: 0, first: entry.time, last: entry.time };
    group.count += 1;
    group.last = entry.time;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || b.last - a.last).slice(0, 20);
}

// ==================== ISSUE DETECTION ====================

function createIssueList() {
  const issues = new Map();
  return {
    add(issue) {
      const existing = issues.get(issue.id);
      if (existing) {
        existing.evidence.push(...(issue.evidence || []));
        existing.affected.push(...(issue.affected || []));
        return existing;
      }
      const created = { evidence: [], affected: [], ...issue };
      created.evidence = [...(issue.evidence || [])];
      created.affected = [...(issue.affected || [])];
      issues.set(issue.id, created);
      return created;
    },
    list() {
      return [...issues.values()]
        .map((issue) => ({ ...issue, evidence: [...new Set(issue.evidence)], affected: [...new Set(issue.affected)] }))
        .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
    },
  };
}

function detectIssues(data) {
  const issues = createIssueList();
  const { failedJobs, tools, cookies, storage, network, entries, recentErrors, renderer, now, autoUpdate } = data;

  for (const job of failedJobs) {
    const label = `${job.title} (${job.jobId})`;
    for (const signature of job.signatures) {
      const evidence = [`${new Date(job.failedAt).toISOString()} ${label}: ${truncate(job.message, 260)}`];
      if (signature.id === "binary-replaced") {
        const modified = tools.ytdlp.modified;
        if (modified >= job.startedAt - 5000 && modified <= job.failedAt) {
          evidence.push(`${new Date(modified).toISOString()} yt-dlp.exe on disk was rewritten while this job was running`);
        }
        for (const update of job.overlappingUpdates) {
          evidence.push(
            `${update.timestamp} tool update ran while this job was active: ${update.message.split("\n")[0]}`,
          );
        }
      }
      issues.add({ ...signature, pattern: undefined, evidence, affected: [label] });
    }
    if (job.overlappingUpdates.length && !job.signatures.some((s) => s.id === "binary-replaced")) {
      issues.add({
        id: "update-overlap",
        severity: "warning",
        title: "A tool update ran while a download was in progress",
        cause: "Tool binaries were replaced mid-job; this can crash or corrupt running downloads.",
        fix: "Ensure checkAndUpdateTools goes through toolUpdateGate.runWhenIdle.",
        workaround: "Retry the download.",
        evidence: job.overlappingUpdates.map((u) => `${u.timestamp} ${u.message.split("\n")[0]} during ${label}`),
        affected: [label],
      });
    }
    if (!job.signatures.length) {
      issues.add({
        id: "unrecognized-failure",
        severity: "warning",
        title: "Download failed with an unrecognized error",
        cause: "No known signature matched. See the dossier timeline and yt-dlp warnings for this job.",
        fix: "Diagnose from the timeline below, then add a signature to backend/services/diagnostics-report.js and a rule to error-classifier.js.",
        workaround: "Retry; update tools if it persists.",
        evidence: [`${label}: ${truncate(job.message, 300)}`],
        affected: [label],
      });
    }
    if (job.settings?.smartRetry && job.attempt === 0 && !job.classification.retryable) {
      issues.add({
        id: "smart-retry-skipped",
        severity: "info",
        title: "Smart retry was enabled but did not retry",
        cause: "error-classifier.js marked the error as non-retryable, so the job failed on its first attempt.",
        fix: "If the error is transient (e.g. a network blip), mark it retryable in classifyRuntimeError.",
        workaround: "Use Retry on the failed item.",
        evidence: [`${label}: classified ${job.classification.category}/${job.classification.code}, retryable=false`],
        affected: [label],
      });
    }
  }

  // Tools
  const ytdlp = tools.ytdlp;
  if (!ytdlp.exists || !ytdlp.runs) {
    issues.add({
      id: "ytdlp-broken",
      severity: "critical",
      title: "yt-dlp is missing or does not run",
      cause: ytdlp.exists ? `Executable exists but failed to run: ${ytdlp.error || ytdlp.version}` : "Executable not found.",
      fix: "Restore resources/bin/yt-dlp.exe (reinstall) and check antivirus quarantine.",
      workaround: "Reinstall the app.",
      evidence: [`path: ${ytdlp.path}`],
    });
  } else if (ytdlp.releaseAgeDays != null && ytdlp.releaseAgeDays > YTDLP_STALE_DAYS) {
    issues.add({
      id: "ytdlp-stale",
      severity: "warning",
      title: `yt-dlp is ${Math.round(ytdlp.releaseAgeDays)} days old`,
      cause: "YouTube changes frequently; old yt-dlp builds commonly fail extraction.",
      fix: autoUpdate === false ? "Auto-update is off; enable it or update manually." : "Check why auto-update has not updated it (see Tools > update checks).",
      workaround: "Settings > Update Tools.",
      evidence: [`version ${ytdlp.version}`],
    });
  }
  if (ytdlp.leftoverOld) {
    issues.add({
      id: "ytdlp-old-binary",
      severity: "info",
      title: "Previous yt-dlp binary (yt-dlp.exe.old) is still present",
      cause: "Left behind by an interrupted update or an older in-place yt-dlp -U. Harmless.",
      fix: "Optional cleanup after a successful update.",
      workaround: "None needed.",
      evidence: [`modified ${new Date(ytdlp.leftoverOld).toISOString()}`],
    });
  }
  if (!ytdlp.binWritable && ytdlp.exists) {
    issues.add({
      id: "bin-not-writable",
      severity: "warning",
      title: "Tool folder is not writable, so yt-dlp self-update cannot work",
      cause: `Cannot write to ${path.dirname(ytdlp.path)} (${ytdlp.binWriteError}).`,
      fix: "Install per-user (AppData) or move tool updates to a writable location.",
      workaround: "Reinstall the latest app version to get fresh tools.",
      evidence: [`bin folder: ${path.dirname(ytdlp.path)}`],
    });
  }
  if (!tools.ffmpeg.exists || !tools.ffmpeg.runs) {
    issues.add({
      id: "ffmpeg-broken",
      severity: "critical",
      title: "FFmpeg is missing or does not run",
      cause: tools.ffmpeg.error || "Executable not found.",
      fix: "Restore resources/bin/ffmpeg.exe.",
      workaround: "Reinstall the app.",
      evidence: [`path: ${tools.ffmpeg.path}`],
    });
  }
  if (!tools.ffprobe.exists) {
    issues.add({
      id: "ffprobe-missing",
      severity: "warning",
      title: "ffprobe is missing",
      cause: "Download verification and thumbnail embedding rely on ffprobe.",
      fix: "Ship ffprobe.exe next to ffmpeg.exe.",
      workaround: "Reinstall the app.",
      evidence: [`path: ${tools.ffprobe.path}`],
    });
  }
  if (!tools.node.exists || !tools.node.runs) {
    issues.add({
      id: "js-runtime-missing",
      severity: "critical",
      title: "Bundled Node runtime for YouTube challenges is missing or broken",
      cause: "Without it yt-dlp cannot solve YouTube's n/signature challenge and only storyboard images remain.",
      fix: "Restore resources/bin/node.exe and confirm NODE_BINARY is passed to the server.",
      workaround: "Reinstall the app.",
      evidence: [`path: ${tools.node.path || "NOT SET"}`, tools.node.error || ""].filter(Boolean),
    });
  }

  const blockedFfmpeg = entries.filter((entry) => /not in the trust manifest/.test(entry.message) && now - entry.time < 30 * DAY_MS);
  if (blockedFfmpeg.length) {
    issues.add({
      id: "ffmpeg-update-blocked",
      severity: "info",
      title: "FFmpeg auto-update is blocked by the trust manifest",
      cause: "A newer FFmpeg exists but its checksum is not in ffmpeg-checksums.json shipped with this build.",
      fix: "Add the new version's checksum to ffmpeg-checksums.json in the next release.",
      workaround: "None needed; current FFmpeg keeps working.",
      evidence: [`${blockedFfmpeg.at(-1).timestamp} ${blockedFfmpeg.at(-1).message.split("\n")[0]}`],
    });
  }

  // Cookies
  if (!cookies.exists) {
    issues.add({
      id: "cookies-missing",
      severity: failedJobs.some((job) => job.signatures.some((s) => s.id === "youtube-bot-check")) ? "critical" : "info",
      title: "No cookies file is configured",
      cause: "YouTube increasingly requires a signed-in session to avoid bot checks.",
      fix: "None if downloads work; otherwise guide the user through cookie import.",
      workaround: "Import cookies from a signed-in browser.",
      evidence: [`expected at ${cookies.path}`],
    });
  } else {
    const auth = Object.entries(cookies.youtubeAuth || {});
    const valid = auth.filter(([, info]) => info.state !== "expired");
    if (!cookies.validHeader || cookies.malformed) {
      issues.add({
        id: "cookies-malformed",
        severity: "warning",
        title: "Cookies file is malformed",
        cause: `${cookies.validHeader ? "Header ok" : "Missing Netscape header"}, ${cookies.malformed || 0} malformed rows.`,
        fix: "Tighten validation in cookie import (isValidCookiesText).",
        workaround: "Re-import cookies.",
        evidence: [`${cookies.total} rows`],
      });
    }
    if (!auth.length) {
      issues.add({
        id: "cookies-signed-out",
        severity: "warning",
        title: "Cookies contain no YouTube login cookies",
        cause: "The cookies were exported from a signed-out session, so they do not help with bot checks.",
        fix: "Warn on import when no login cookies are present.",
        workaround: "Sign in to YouTube in the browser, then re-import cookies.",
        evidence: [`${cookies.total} cookies, none of: ${YOUTUBE_AUTH_COOKIES.join(", ")}`],
      });
    } else if (!valid.length) {
      issues.add({
        id: "cookies-expired",
        severity: "critical",
        title: "All YouTube login cookies have expired",
        cause: "The signed-in session in the cookies file is no longer valid.",
        fix: "Prompt for re-import when login cookies are expired.",
        workaround: "Re-import cookies from a signed-in browser.",
        evidence: auth.map(([name, info]) => `${name}: ${info.state}`),
      });
    }
  }

  // Storage
  if (storage.downloadDir) {
    if (!storage.exists) {
      issues.add({
        id: "download-folder-missing",
        severity: "critical",
        title: "Download folder does not exist",
        cause: "The configured folder was deleted, renamed, or is on a disconnected drive.",
        fix: "Recreate the folder on demand or fall back to the default folder.",
        workaround: "Choose a download folder in Settings.",
        evidence: [storage.downloadDir],
      });
    } else if (!storage.writable) {
      issues.add({
        id: "download-folder-readonly",
        severity: "critical",
        title: "Download folder is not writable",
        cause: storage.writeError,
        fix: "Surface this in the UI before starting downloads.",
        workaround: "Choose another download folder.",
        evidence: [storage.downloadDir],
      });
    }
    if (Number.isFinite(storage.free) && storage.free < LOW_DISK_BYTES) {
      issues.add({
        id: "low-disk",
        severity: storage.free < CRITICAL_DISK_BYTES ? "critical" : "warning",
        title: `Low disk space: ${formatBytes(storage.free)} free`,
        cause: "High-quality downloads need several GB including temporary merge files.",
        fix: "Check free space before starting large downloads.",
        workaround: "Free up space or change the download folder.",
        evidence: [`${storage.downloadDir}: ${formatBytes(storage.free)} of ${formatBytes(storage.total)}`],
      });
    }
  }

  // Network
  const offline = network.filter((probe) => !probe.ok);
  if (offline.length) {
    issues.add({
      id: "connectivity",
      severity: offline.length === network.length ? "critical" : "warning",
      title: "Connectivity check failed",
      cause: "The app could not reach one or more required hosts.",
      fix: "Check DNS/proxy/firewall; yt-dlp and tool updates need these hosts.",
      workaround: "Check the internet connection or VPN.",
      evidence: offline.map((probe) => `${probe.url}: ${probe.error || `HTTP ${probe.status}`}`),
    });
  }

  // Recurring errors in the log that are not tied to a currently failed job.
  for (const group of recentErrors) {
    if (group.count < 3 || group.level !== "ERROR") continue;
    const signature = matchSignatures(group.message)[0];
    if (signature) {
      issues.add({
        ...signature,
        pattern: undefined,
        evidence: [`${group.count}× in last 7 days (last ${new Date(group.last).toISOString()}): ${group.message}`],
      });
    }
  }
  if (entries.some((entry) => /Graceful shutdown timed out/.test(entry.message) && now - entry.time < 7 * DAY_MS)) {
    issues.add({
      id: "shutdown-timeout",
      severity: "info",
      title: "Server shutdown timed out and was forced",
      cause: "A child process or pending write did not finish within the shutdown window.",
      fix: "Check gracefulShutdown for processes that are not killed or awaited.",
      workaround: "None needed.",
      evidence: entries.filter((e) => /Graceful shutdown timed out/.test(e.message)).slice(-3).map((e) => e.timestamp),
    });
  }

  if (renderer?.errors?.length) {
    issues.add({
      id: "renderer-errors",
      severity: "warning",
      title: `${renderer.errors.length} error(s) in the app window (UI)`,
      cause: "JavaScript errors in the renderer can break buttons, progress updates, or settings.",
      fix: "See Renderer section for messages and source locations.",
      workaround: "Restart the app.",
      evidence: renderer.errors.slice(-5).map((error) => `${error.time || ""} ${error.type}: ${truncate(error.message, 200)}`),
    });
  }

  return issues.list();
}

// ==================== COLLECTION ====================

async function collectDiagnostics(context, { renderer = null, now = Date.now() } = {}) {
  const {
    appInfo = {},
    paths = {},
    executables = {},
    getToolVersion,
    getLastUpdateCheck = () => 0,
    state = {},
    toolUpdateGate = null,
    isAutoUpdateEnabled = () => null,
    probeNetwork = true,
    redact = createRedactor(),
  } = context;

  const { entries, sources } = await readLogEntries(paths.logFile);

  const [ytdlpVersionRaw, ffmpegVersionRaw, nodeProbe, ffprobeProbe, network] = await Promise.all([
    executables.ytdlp ? getToolVersion(executables.ytdlp) : "not configured",
    executables.ffmpeg ? getToolVersion(executables.ffmpeg) : "not configured",
    runProbe(executables.node, ["--version"]),
    runProbe(executables.ffprobe, ["-version"]),
    probeNetwork
      ? Promise.all(["https://www.youtube.com/", "https://github.com/"].map((url) => probeUrl(url)))
      : Promise.resolve([]),
  ]);

  const ytdlpVersion = String(ytdlpVersionRaw || "").trim();
  const ffmpegVersion = String(ffmpegVersionRaw || "").trim();
  const ffmpegRuns = Boolean(ffmpegVersion) && !/^(error|unknown|not configured)$/.test(ffmpegVersion);
  const ytdlpStats = await statSafe(executables.ytdlp);
  const ytdlpOldStats = executables.ytdlp ? await statSafe(`${executables.ytdlp}.old`) : null;
  const binWrite = ytdlpStats ? await checkWritable(path.dirname(executables.ytdlp)) : { writable: false };
  const ytdlpReleased = parseYtDlpVersionDate(ytdlpVersion);
  const tools = {
    ytdlp: {
      path: executables.ytdlp,
      exists: Boolean(ytdlpStats),
      runs: Boolean(ytdlpVersion) && !/^(error|unknown|not configured)$/.test(ytdlpVersion),
      version: ytdlpVersion,
      size: ytdlpStats?.size,
      modified: ytdlpStats?.mtimeMs,
      releaseAgeDays: ytdlpReleased ? (now - ytdlpReleased) / DAY_MS : null,
      leftoverOld: ytdlpOldStats?.mtimeMs || null,
      binWritable: binWrite.writable,
      binWriteError: binWrite.error,
      lastUpdateCheck: getLastUpdateCheck("ytdlp"),
    },
    ffmpeg: {
      path: executables.ffmpeg,
      // Bare names ("ffmpeg") resolve through PATH, so running counts as present.
      exists: ffmpegRuns || Boolean(await statSafe(executables.ffmpeg)),
      runs: ffmpegRuns,
      version: ffmpegVersion,
      lastUpdateCheck: getLastUpdateCheck("ffmpeg"),
    },
    ffprobe: {
      path: executables.ffprobe,
      exists: ffprobeProbe.ok || Boolean(await statSafe(executables.ffprobe)),
      version: ffprobeProbe.output,
      error: ffprobeProbe.error,
    },
    node: {
      path: executables.node,
      exists: nodeProbe.ok || Boolean(await statSafe(executables.node)),
      runs: nodeProbe.ok,
      version: nodeProbe.output,
      error: nodeProbe.error,
    },
  };

  const cookies = await inspectCookies(paths.cookiesPath, now);

  const failedRaw = mapValues(state.failedDownloads)
    .sort((a, b) => (Date.parse(b[1]?.failedAt || "") || 0) - (Date.parse(a[1]?.failedAt || "") || 0));
  const failedJobs = failedRaw
    .slice(0, MAX_FAILED_JOBS)
    .map(([jobId, job]) => analyzeFailedJob({ jobId, job: job || {}, entries, cookiesPresent: cookies.exists }));

  const latestSettings =
    renderer?.settings || failedRaw[0]?.[1]?.settings || mapValues(state.activeProcesses)[0]?.[1]?.settings || null;
  const downloadDir = latestSettings?.downloadFolder || paths.downloadDir;
  const downloadStats = downloadDir ? await statSafe(downloadDir) : null;
  const storage = { downloadDir, exists: Boolean(downloadStats?.isDirectory()) };
  if (storage.exists) {
    const write = await checkWritable(downloadDir);
    storage.writable = write.writable;
    storage.writeError = write.error;
    Object.assign(storage, await diskFree(downloadDir));
  }
  const dataDisk = paths.dataRoot ? await diskFree(paths.dataRoot) : {};

  const recentErrors = groupRecentErrors(entries, now);
  const knownIds = new Set(failedRaw.map(([jobId]) => jobId));
  const loggedFailures = findLoggedFailures(entries, knownIds, now);

  const queue = {
    active: mapValues(state.activeProcesses).map(([id, info]) => ({
      id,
      title: info?.title || info?.itemData?.title,
      paused: info?.paused === true,
      cancelled: info?.cancelled === true,
      hasYtdlp: Boolean(info?.ytdlpProc),
      hasFfmpeg: Boolean(info?.ffmpegProc),
    })),
    queued: mapValues(state.downloadQueue).length,
    paused: mapValues(state.pausedDownloads).length,
    scheduled: mapValues(state.scheduledDownloads).length,
    failed: failedRaw.length,
    clients: state.clients?.size ?? null,
    gate: toolUpdateGate
      ? { activeToolProcesses: toolUpdateGate.activeCount, updating: toolUpdateGate.isUpdating }
      : null,
  };

  const autoUpdate = isAutoUpdateEnabled();
  const data = {
    now,
    appInfo,
    paths,
    tools,
    cookies,
    storage,
    dataDisk,
    network,
    failedJobs,
    loggedFailures,
    recentErrors,
    queue,
    settings: latestSettings,
    renderer,
    logSources: sources,
    entries,
    autoUpdate,
    system: {
      platform: process.platform,
      arch: process.arch,
      osType: os.type(),
      osRelease: os.release(),
      osVersion: typeof os.version === "function" ? os.version() : "",
      cpus: os.cpus().length,
      cpuModel: os.cpus()[0]?.model?.trim(),
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
      uptimeSec: os.uptime(),
      locale: process.env.GVL_APP_LOCALE || Intl.DateTimeFormat().resolvedOptions().locale,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    process: {
      node: process.version,
      electron: process.versions.electron || "N/A",
      chrome: process.versions.chrome || "N/A",
      v8: process.versions.v8,
      pid: process.pid,
      uptimeSec: process.uptime(),
      rss: process.memoryUsage().rss,
      packaged: process.env.GVL_APP_PACKAGED === "1",
      nodeEnv: process.env.NODE_ENV || "production",
      execPath: process.execPath,
    },
  };
  data.issues = detectIssues(data);
  return { data, text: redact(renderReport(data)) };
}

// ==================== RENDERING ====================

function renderReport(data) {
  const out = [];
  const iso = (ms) => (Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : "never");
  const counts = { critical: 0, warning: 0, info: 0 };
  data.issues.forEach((issue) => { counts[issue.severity] += 1; });

  out.push("# GetVideosLocally Diagnostics Report");
  out.push(`Generated: ${new Date(data.now).toISOString()} · App ${data.appInfo.version || "?"} · Report schema ${REPORT_SCHEMA}`);
  out.push("");
  out.push("## 1. Verdict");
  if (!data.issues.length) {
    out.push("No problems detected. Tools, cookies, storage and network all checked out and there are no failed downloads.");
  } else {
    out.push(`${counts.critical} critical, ${counts.warning} warning, ${counts.info} info.`);
    const top = data.issues[0];
    out.push(`Most likely cause of the latest failure: **${(data.failedJobs[0]?.primary || top).title}**`);
  }
  out.push("");
  out.push("Legend for timelines: ' ' = this job, '!' = app-wide event (updates, errors), '~' = another job's error.");
  out.push("");

  out.push("## 2. Detected issues (most severe first)");
  if (!data.issues.length) out.push("None.");
  data.issues.forEach((issue, index) => {
    out.push("");
    out.push(`### ${index + 1}. [${issue.severity.toUpperCase()}] ${issue.title}`);
    out.push(`- Issue id: ${issue.id}`);
    if (issue.affected.length) out.push(`- Affects: ${issue.affected.join("; ")}`);
    out.push(`- Cause: ${issue.cause}`);
    out.push(`- Fix (developer): ${issue.fix}`);
    out.push(`- Workaround (user): ${issue.workaround}`);
    if (issue.evidence.length) {
      out.push("- Evidence:");
      issue.evidence.slice(0, 8).forEach((line) => out.push(`    ${truncate(line)}`));
    }
  });
  out.push("");

  out.push(`## 3. Failed downloads (${data.queue.failed} stored, showing ${data.failedJobs.length})`);
  if (!data.failedJobs.length) out.push("None stored.");
  data.failedJobs.forEach((job, index) => {
    out.push("");
    out.push(`### 3.${index + 1} ${job.title}`);
    out.push(`- Job id: ${job.jobId}`);
    out.push(`- URL: ${job.url || "unknown"}`);
    out.push(`- Site: ${job.site} · Format: ${job.format || "?"} · Quality: ${job.quality || "?"}${job.playlistAction ? ` · Playlist: ${job.playlistAction}` : ""}`);
    out.push(`- Started: ${iso(job.startedAt)} · Failed: ${iso(job.failedAt)} (ran ${formatAge(job.failedAt - job.startedAt)}) · Attempt: ${job.attempt}`);
    out.push(`- Error: ${truncate(job.message, 600)}`);
    out.push(`- Classifier: category=${job.classification.category} code=${job.classification.code} retryable=${job.classification.retryable}`);
    out.push(`- Diagnosis: ${job.primary ? `${job.primary.title} [${job.primary.id}]` : "no known signature matched"}`);
    if (job.signatures.length > 1) out.push(`- Also matched: ${job.signatures.filter((s) => s !== job.primary).map((s) => s.id).join(", ")}`);
    if (job.overlappingUpdates.length) {
      out.push(`- Tool update during job: ${job.overlappingUpdates.map((u) => `${u.timestamp} ${u.message.split("\n")[0]}`).join("; ")}`);
    }
    if (job.warnings.length) {
      out.push("- yt-dlp warnings:");
      job.warnings.slice(0, 10).forEach((warning) => out.push(`    ${truncate(warning)}`));
    }
    if (job.reproArgs) {
      out.push("- Reproduce (exact yt-dlp invocation):");
      out.push("```");
      out.push(`"${data.tools.ytdlp.path}" ${job.reproArgs.map(quoteArg).join(" ")}`);
      out.push("```");
    }
    out.push(`- Timeline${job.hasLogEvidence ? "" : " (no log lines found for this job; log may have rotated)"}:`);
    out.push("```");
    job.timeline.forEach((line) => out.push(truncate(line)));
    out.push("```");
  });
  if (data.loggedFailures.length) {
    out.push("");
    out.push("### Other failures in the last 7 days (from log, no longer in the failed list)");
    data.loggedFailures.forEach((failure) => {
      const signature = matchSignatures(failure.message)[0];
      out.push(`- ${iso(failure.time)} ${failure.jobId} (exit ${failure.code}): ${truncate(failure.message, 260)}${signature ? ` → ${signature.id}` : ""}`);
    });
  }
  out.push("");

  const t = data.tools;
  out.push("## 4. Tools and runtimes");
  out.push(`- yt-dlp: ${t.ytdlp.version} · ${t.ytdlp.exists ? "present" : "MISSING"} · ${t.ytdlp.runs ? "runs" : "DOES NOT RUN"} · release age ${t.ytdlp.releaseAgeDays != null ? `${Math.round(t.ytdlp.releaseAgeDays)}d` : "unknown"} · ${formatBytes(t.ytdlp.size)} · binary modified ${iso(t.ytdlp.modified)}`);
  out.push(`  path: ${t.ytdlp.path} · bin folder writable: ${t.ytdlp.binWritable ? "yes" : `NO (${t.ytdlp.binWriteError || "?"})`} · yt-dlp.exe.old: ${t.ytdlp.leftoverOld ? iso(t.ytdlp.leftoverOld) : "none"}`);
  out.push(`- FFmpeg: ${t.ffmpeg.version} · ${t.ffmpeg.exists ? "present" : "MISSING"} · ${t.ffmpeg.runs ? "runs" : "DOES NOT RUN"} · path: ${t.ffmpeg.path}`);
  out.push(`- ffprobe: ${t.ffprobe.exists ? t.ffprobe.version || "present" : "MISSING"} · path: ${t.ffprobe.path}`);
  out.push(`- JavaScript runtime (YouTube challenges): ${t.node.exists ? (t.node.runs ? `node ${t.node.version}` : `BROKEN (${t.node.error})`) : "MISSING"} · path: ${t.node.path || "NOT SET"}`);
  out.push(`- Auto-update: ${data.autoUpdate == null ? "unknown (no client connected)" : data.autoUpdate ? "enabled" : "disabled"} · last yt-dlp check ${iso(t.ytdlp.lastUpdateCheck)} · last FFmpeg check ${iso(t.ffmpeg.lastUpdateCheck)}`);
  const updateEvents = data.entries
    .filter((entry) => /updated successfully|download\/install failed|update check failed|Tool update (?:deferred|skipped)/.test(entry.message))
    .slice(-6);
  if (updateEvents.length) {
    out.push("- Recent update events:");
    updateEvents.forEach((entry) => out.push(`    ${entry.timestamp} ${entry.level} ${truncate(entry.message.split("\n")[0], 200)}`));
  }
  out.push("");

  const c = data.cookies;
  out.push("## 5. Cookies (names and expiry only, never values)");
  if (!c.exists) {
    out.push(`- No cookies file at ${c.path}`);
  } else {
    out.push(`- File: ${c.path} · ${formatBytes(c.size)} · updated ${formatAge(c.modifiedAgoMs)} ago · header ${c.validHeader ? "ok" : "INVALID"} · ${c.total} cookies (${c.malformed} malformed)`);
    out.push(`- Domains: ${(c.topDomains || []).map(([domain, count]) => `${domain} (${count})`).join(", ") || "none"}`);
    const auth = Object.entries(c.youtubeAuth || {});
    out.push(`- YouTube login cookies: ${auth.length ? auth.map(([name, info]) => `${name}=${info.state}${info.expiresInMs != null ? ` (${info.expiresInMs > 0 ? "expires in" : "expired"} ${formatAge(info.expiresInMs)})` : ""}`).join(", ") : "NONE (signed-out export)"}`);
  }
  out.push("");

  const s = data.storage;
  out.push("## 6. Storage");
  out.push(`- Download folder: ${s.downloadDir || "unknown"} · ${s.exists ? "exists" : "MISSING"}${s.exists ? ` · writable: ${s.writable ? "yes" : `NO (${s.writeError})`} · free ${formatBytes(s.free)} of ${formatBytes(s.total)}` : ""}`);
  out.push(`- App data: ${data.paths.dataRoot} · free ${formatBytes(data.dataDisk.free)}`);
  out.push(`- Logs read: ${data.logSources.map((src) => `${path.basename(src.file)} (${src.error ? `error: ${src.error}` : `${src.entries} entries, ${formatBytes(src.bytes)}`})`).join(", ") || "none"}`);
  out.push("");

  out.push("## 7. Network");
  if (!data.network.length) out.push("- Not probed.");
  data.network.forEach((probe) => out.push(`- ${probe.url}: ${probe.ok ? `reachable (HTTP ${probe.status}, ${probe.ms} ms)` : `FAILED (${probe.error || `HTTP ${probe.status}`}, ${probe.ms} ms)`}`));
  out.push("");

  const q = data.queue;
  out.push("## 8. Queue state at report time");
  out.push(`- Active: ${q.active.length} · Queued: ${q.queued} · Paused: ${q.paused} · Scheduled: ${q.scheduled} · Failed: ${q.failed} · Connected windows: ${q.clients ?? "?"}`);
  if (q.gate) out.push(`- Tool update gate: ${q.gate.activeToolProcesses} running tool process(es), update in progress: ${q.gate.updating ? "yes" : "no"}`);
  q.active.slice(0, 10).forEach((item) => out.push(`    ${item.id}: ${item.title || "?"}${item.paused ? " [paused]" : ""}${item.cancelled ? " [cancelled]" : ""} yt-dlp=${item.hasYtdlp ? "running" : "-"} ffmpeg=${item.hasFfmpeg ? "running" : "-"}`));
  out.push("");

  out.push("## 9. Recurring errors and warnings (last 7 days, grouped)");
  if (!data.recentErrors.length) out.push("None.");
  data.recentErrors.forEach((group) => out.push(`- ${String(group.count).padStart(3)}× ${group.level} (last ${iso(group.last)}): ${group.message}`));
  out.push("");

  out.push("## 10. Settings");
  if (!data.settings) {
    out.push("- Not available (no connected window and no stored job settings).");
  } else {
    const entries = Object.entries(data.settings).filter(([key]) => !/token|password|secret|clientId/i.test(key));
    out.push(entries.map(([key, value]) => `${key}=${typeof value === "object" ? JSON.stringify(value) : value}`).join(" · "));
  }
  out.push("");

  out.push("## 11. App window (renderer)");
  if (!data.renderer) {
    out.push("- Not supplied (report requested without the app window).");
  } else {
    const r = data.renderer;
    out.push(`- Window: ${r.viewport || "?"} @${r.devicePixelRatio || "?"}x · UI scale ${data.settings?.uiScale ?? "?"} · online: ${r.online} · WebSocket: ${r.websocketState || "?"} · active tab: ${r.activeTab || "?"}`);
    out.push(`- User agent: ${r.userAgent || "?"}`);
    if (r.errors?.length) {
      out.push(`- Errors captured this session (${r.errors.length}):`);
      r.errors.slice(-15).forEach((error) => out.push(`    ${error.time || ""} ${error.type}: ${truncate(error.message, 300)}${error.source ? ` @ ${error.source}` : ""}`));
    } else {
      out.push("- No renderer errors captured this session.");
    }
  }
  out.push("");

  const sys = data.system;
  const proc = data.process;
  out.push("## 12. System and environment");
  out.push(`- OS: ${sys.osVersion} (${sys.osType} ${sys.osRelease}, ${sys.platform}/${sys.arch}) · locale ${sys.locale} · TZ ${sys.timeZone}`);
  out.push(`- CPU: ${sys.cpuModel} × ${sys.cpus} · RAM ${formatBytes(sys.freeMemory)} free of ${formatBytes(sys.totalMemory)} · OS uptime ${formatAge(sys.uptimeSec * 1000)}`);
  out.push(`- Runtime: Electron ${proc.electron} · Chrome ${proc.chrome} · Node ${proc.node} · V8 ${proc.v8} · packaged ${proc.packaged} · NODE_ENV ${proc.nodeEnv}`);
  out.push(`- Server: pid ${proc.pid} · up ${formatAge(proc.uptimeSec * 1000)} · RSS ${formatBytes(proc.rss)} · exec ${proc.execPath}`);
  out.push("");
  out.push("---");
  out.push(
    "Privacy: includes failed video page URLs and titles (needed to reproduce), app settings, and log excerpts. " +
    "Cookie values, tokens, signed media URLs, email addresses and your Windows user folder name are redacted.",
  );
  return out.join("\n");
}

module.exports = {
  inspectCookies,
  summarizeCookieHealth,
  SIGNATURES,
  collectDiagnostics,
  createRedactor,
  detectIssues,
  matchSignatures,
  parseLogEntries,
  renderReport,
};
