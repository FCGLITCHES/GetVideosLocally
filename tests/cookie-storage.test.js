"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { getCookiesFilePath, isValidCookiesText, YTDLP_COOKIES_DIR_NAME } = require("../backend/utils/cookie-storage");

const source = fs.readFileSync(path.join(__dirname, "..", "electron-main.js"), "utf8");
const COOKIE_TEXT = "# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tvalue\n";

function loadMigration(userDataPath) {
  const start = source.indexOf("function isUsableCookiesFile");
  const end = source.indexOf("function isFirewallPermissionError", start);
  assert.ok(start >= 0 && end > start);
  const context = {
    fs, path, getCookiesFilePath, isValidCookiesText,
    app: { getPath: () => userDataPath },
    resourcesCookiesPath: path.join(userDataPath, "ytdlp-cookies"),
    console: { log() {}, warn() {} },
  };
  vm.runInNewContext(`${source.slice(start, end)}\nthis.migrate = migrateLegacyChromiumCookiesDirectory;`, context);
  return context;
}

function makeUserData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gvl-cookies-"));
}

test("yt-dlp cookies folder cannot collide with Chromium's case-insensitive Cookies path", () => {
  assert.notEqual(YTDLP_COOKIES_DIR_NAME.toLowerCase(), "cookies");
  assert.match(source, /resourcesCookiesPath = path\.dirname\(getCookiesFilePath\(app\.getPath\('userData'\)\)\)/);
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(server, /getCookiesFilePath\(env\.USER_DATA_PATH \|\| fallbackUserDataRoot\)/);
  assert.doesNotMatch(server, /env\.COOKIES_DIR|cachedCookiesPathResult/);
});

test("startup restores the newest cookies.txt that an earlier startup renamed away", (t) => {
  const userData = makeUserData();
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  for (const [stamp, text] of [["1000", `${COOKIE_TEXT}# old\n`], ["2000", `${COOKIE_TEXT}# newest\n`]]) {
    fs.mkdirSync(path.join(userData, `Cookies.legacy-dir.${stamp}`));
    fs.writeFileSync(path.join(userData, `Cookies.legacy-dir.${stamp}`, "cookies.txt"), text);
  }
  fs.mkdirSync(path.join(userData, "Cookies"));

  const context = loadMigration(userData);
  context.migrate();

  const restored = fs.readFileSync(path.join(context.resourcesCookiesPath, "cookies.txt"), "utf8");
  assert.match(restored, /# newest/);
  assert.equal(fs.existsSync(path.join(userData, "Cookies")), false);
  assert.equal(fs.existsSync(path.join(userData, "Cookies.legacy-dir.2000", "cookies.txt")), false);
  assert.equal(fs.existsSync(path.join(userData, "Cookies.legacy-dir.1000", "cookies.txt")), false);
});

test("canonical cookies remain unchanged while legacy text copies are removed", (t) => {
  const userData = makeUserData();
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  fs.mkdirSync(path.join(userData, "Cookies.legacy-dir.1000"));
  fs.writeFileSync(path.join(userData, "Cookies.legacy-dir.1000", "cookies.txt"), COOKIE_TEXT);
  fs.mkdirSync(path.dirname(getCookiesFilePath(userData)));
  fs.writeFileSync(getCookiesFilePath(userData), `${COOKIE_TEXT}# canonical\n`);
  const context = loadMigration(userData);
  context.migrate();
  assert.equal(fs.readFileSync(getCookiesFilePath(userData), "utf8"), `${COOKIE_TEXT}# canonical\n`);
  assert.equal(fs.existsSync(path.join(userData, "Cookies.legacy-dir.1000", "cookies.txt")), false);
});

test("Netscape validation accepts HttpOnly rows and rejects malformed imports", () => {
  assert.ok(isValidCookiesText(COOKIE_TEXT));
  assert.ok(isValidCookiesText(COOKIE_TEXT.replace(".youtube.com", "#HttpOnly_.youtube.com")));
  assert.ok(isValidCookiesText(COOKIE_TEXT.replace(/\n/g, "\r\n")));
  assert.ok(isValidCookiesText(`\uFEFF${COOKIE_TEXT}`));
  assert.equal(isValidCookiesText("youtube.com invalid cookies"), false);
  assert.equal(isValidCookiesText("# Netscape HTTP Cookie File\n"), false);
  assert.equal(isValidCookiesText(COOKIE_TEXT.replace("\tTRUE\t", "\tinvalid\t")), false);
});

test("cleared canonical cookies are never restored from stale legacy copies", (t) => {
  const userData = makeUserData();
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  fs.mkdirSync(path.dirname(getCookiesFilePath(userData)));
  fs.writeFileSync(getCookiesFilePath(userData), "");
  fs.mkdirSync(path.join(userData, "Cookies.legacy-dir.1000"));
  fs.writeFileSync(path.join(userData, "Cookies.legacy-dir.1000", "cookies.txt"), COOKIE_TEXT);
  loadMigration(userData).migrate();
  assert.equal(fs.readFileSync(getCookiesFilePath(userData), "utf8"), "");
  assert.equal(fs.existsSync(path.join(userData, "Cookies.legacy-dir.1000", "cookies.txt")), false);
});

test("startup never overwrites or resurrects cookies once the new folder exists", (t) => {
  const userData = makeUserData();
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  fs.mkdirSync(path.join(userData, "Cookies.legacy-dir.1000"));
  fs.writeFileSync(path.join(userData, "Cookies.legacy-dir.1000", "cookies.txt"), COOKIE_TEXT);
  fs.mkdirSync(path.join(userData, "ytdlp-cookies"));

  const context = loadMigration(userData);
  context.migrate();

  assert.equal(fs.existsSync(path.join(context.resourcesCookiesPath, "cookies.txt")), false);
});
