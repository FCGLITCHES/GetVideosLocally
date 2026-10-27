"use strict";
// Launches the packaged app and checks that Electron starts, opens the main
// window and serves it from the local backend. Used by CI after packaging.
//   node scripts/ci-launch-check.js [path/to/GetVideosLocally.exe]
const { spawn, execFileSync } = require("child_process");
const path = require("path");

const exe = path.resolve(process.argv[2] || "dist/win-unpacked/GetVideosLocally.exe");
const expectedElectron = require("../package.json").devDependencies.electron;
const port = 9339;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(pathname) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}${pathname}`);
    return response.ok ? response.json() : null;
  } catch {
    return null;
  }
}

async function main() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(exe, [`--remote-debugging-port=${port}`], { stdio: "ignore", env });
  try {
    let version = null;
    let page = null;
    for (let i = 0; i < 120 && !page; i++) {
      version = version || (await getJson("/json/version"));
      const targets = (await getJson("/json/list")) || [];
      page = targets.find((t) => t.type === "page" && /^http:\/\/127\.0\.0\.1:\d+\/?/.test(t.url));
      if (!page) await sleep(500);
    }
    if (!version) throw new Error("the app never opened its debugging port");
    const electron = (version["User-Agent"].match(/Electron\/([\d.]+)/) || [])[1];
    console.log(`Electron ${electron}, ${version.Browser}`);
    if (electron !== expectedElectron) {
      throw new Error(`expected Electron ${expectedElectron}, got ${electron}`);
    }
    if (!page) throw new Error("the main window never loaded from the local backend");
    const response = await fetch(page.url);
    if (!response.ok) throw new Error(`the backend answered ${response.status} for ${page.url}`);
    console.log(`Main window loaded from ${page.url}`);
  } finally {
    try {
      execFileSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {}
  }
}

main().catch((error) => {
  console.error(`Launch check failed: ${error.message}`);
  process.exitCode = 1;
});
