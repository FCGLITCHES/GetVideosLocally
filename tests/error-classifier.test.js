const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { classifyRuntimeError, ERROR_CODES } = require("../backend/services/error-classifier");

test("media stream 403 is not blamed on imported cookies", () => {
  const result = classifyRuntimeError({
    message:
      "The media stream was refused by the site (HTTP 403). Original error: ERROR: unable to download video data: HTTP Error 403: Forbidden",
    hasCookies: true,
    siteKey: "youtube",
  });
  assert.equal(result.code, ERROR_CODES.streamForbidden);
  assert.doesNotMatch(result.userMessage, /expired/i);
});

test("sign-in challenges with cookies still report expired cookies", () => {
  const result = classifyRuntimeError({
    message: "Sign in to confirm you're not a bot",
    hasCookies: true,
    siteKey: "youtube",
  });
  assert.equal(result.code, ERROR_CODES.cookieExpired);
  assert.match(result.userMessage, /saved cookie session was rejected/i);
});

test("rotated YouTube sessions explain that saving does not prove account access", () => {
  const result = classifyRuntimeError({
    message: "The provided YouTube account cookies are no longer valid. They have likely been rotated in the browser as a security measure.",
    hasCookies: true,
    siteKey: "youtube",
  });
  assert.equal(result.code, ERROR_CODES.cookieExpired);
  assert.match(result.userMessage, /Export fresh cookies and retry/);
});

test("rejected sessions get specific recovery guidance before generic login help", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");
  const context = {};
  vm.runInNewContext(renderer.slice(renderer.indexOf("    function buildFailureHelpConfig("), renderer.indexOf("    function showFailureHelp(")) + ";this.build = buildFailureHelpConfig;", context);
  const result = context.build("The saved cookie session was rejected. Export fresh cookies and retry.");
  assert.equal(result.id, "cookies_rejected");
  assert.equal(result.actionLabel, "Import Fresh Cookies");
  assert.match(result.description, /file was found and used/);
});

test("youtube stream 403 retries once through the HLS fallback", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(server, /function buildYouTubeHlsFallbackArgs\(baseArgs\)/);
  assert.match(server, /code === "STREAM_FORBIDDEN"/);
  assert.match(server, /youtube:player_client=default,web_safari/);
  assert.match(server, /b\[protocol\*=m3u8\]/);
});
