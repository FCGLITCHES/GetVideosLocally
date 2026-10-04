"use strict";

// Drive the real Electron renderer without replacing its preload or backend.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const evidence = path.join(__dirname, "..", "reports", "cookie-fix");
fs.mkdirSync(evidence, { recursive: true });
process.env.NODE_ENV = "development";
let main;
let busy = false;
app.on("browser-window-created", (_, win) => {
  win.webContents.on("did-finish-load", () => {
    if (win.webContents.getURL().startsWith("http://127.0.0.1:")) {
      main = win;
      fs.writeFileSync(path.join(evidence, "ready.json"), JSON.stringify({ url: win.webContents.getURL(), userData: app.getPath("userData") }));
    }
  });
});
setInterval(async () => {
  const input = path.join(evidence, "command.json");
  if (!main || busy || !fs.existsSync(input)) return;
  busy = true;
  const command = JSON.parse(fs.readFileSync(input, "utf8"));
  fs.unlinkSync(input);
  try {
    const target = command.target === "cookies"
      ? BrowserWindow.getAllWindows().find(win => win.webContents.getURL().startsWith("file:")) : main;
    if (!target) throw new Error("Target window is not open");
    const value = await target.webContents.executeJavaScript(command.expression, true);
    if (command.screenshot) {
      fs.writeFileSync(path.join(evidence, command.screenshot), (await target.webContents.capturePage()).toPNG());
    }
    fs.writeFileSync(path.join(evidence, "result.json"), JSON.stringify({ id: command.id, value }, null, 2));
  } catch (error) {
    fs.writeFileSync(path.join(evidence, "result.json"), JSON.stringify({ id: command.id, error: error.message }));
  } finally { busy = false; }
}, 200).unref();
require("../electron-main.js");
