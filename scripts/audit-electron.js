"use strict";

// Launch the real app with isolated user data; inspect its sandboxed preload.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gvl-electron-audit-"));
app.setPath("userData", dir);
process.env.NODE_ENV = "development";
process.env.USER_DATA_PATH = dir;
let complete = false;
let appPort;
const checks = [];
const check = name => { checks.push(name); console.log(`PASS ${name}`); };
const fail = error => { console.error(error); process.exitCode = 1; app.quit(); };

app.on("browser-window-created", (_, win) => {
  win.webContents.on("did-finish-load", async () => {
    if (complete || !win.webContents.getURL().startsWith("http://127.0.0.1:")) return;
    complete = true;
    try {
      appPort = new URL(win.webContents.getURL()).port;
      const prefs = win.webContents.getLastWebPreferences();
      assert.equal(prefs.sandbox, true); assert.equal(prefs.contextIsolation, true);
      assert.equal(prefs.nodeIntegration, false); check("real Electron window runs with sandbox and context isolation");
      const result = await win.webContents.executeJavaScript(`(async () => {
        const token = await window.electronAPI.getServerToken();
        const folder = await window.electronAPI.getDefaultDownloadFolder();
        const response = await window.localApiAuth.authorizedFetch('/history-index?clientId=electron-audit');
        return { tokenAvailable: typeof token === 'string' && token.length === 64,
          folderAvailable: typeof folder === 'string' && folder.length > 0,
          apiStatus: response.status, historyTab: Boolean(document.querySelector('[data-tab="history"]')) };
      })()`);
      assert.equal(result.tokenAvailable, true); assert.equal(result.folderAvailable, true);
      assert.equal(result.apiStatus, 200); check("sandboxed preload calls trusted IPC and authenticated local API");
      await win.webContents.executeJavaScript("window.electronAPI.openCookiesHelper()");
      const cookie = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Cookie window timeout")), 10000);
        const poll = () => {
          const child = BrowserWindow.getAllWindows().find(value => value !== win && value.webContents.getURL().startsWith("file:"));
          if (child && !child.webContents.isLoading()) { clearTimeout(timeout); resolve(child); }
          else setTimeout(poll, 50);
        }; poll();
      });
      assert.equal(cookie.webContents.getLastWebPreferences().sandbox, true);
      const cookieResult = await cookie.webContents.executeJavaScript(`(async () => {
        const saved = await window.electronAPI.saveCookiesTxt('# Netscape HTTP Cookie File\\n.example.test\\tTRUE\\t/\\tTRUE\\t0\\tSID\\ttest-value\\n');
        const read = await window.electronAPI.getCookiesTxt();
        return { saved: saved.success, read: read.success, content: read.content };
      })()`);
      assert.equal(cookieResult.saved, true); assert.equal(cookieResult.read, true);
      assert.match(cookieResult.content, /Netscape/); check("cookie helper remains functional with sandbox and sender validation");
      fs.writeFileSync(path.join(os.tmpdir(), "gvl-audit-electron-result.json"), JSON.stringify({
        passed: checks.length, checks, isolatedData: dir, serverPort: appPort,
      }, null, 2));
      await win.webContents.executeJavaScript("window.electronAPI.updateDownloadCount(0)");
      cookie.close(); win.close();
    } catch (error) { fail(error); }
  });
});

app.on("will-quit", () => {
  if (!complete) process.exitCode = 1;
});
require("../electron-main.js");
setTimeout(() => { if (!complete) fail(new Error("Electron audit startup timed out")); }, 30000).unref();
