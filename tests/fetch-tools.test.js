"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const AdmZip = require("adm-zip");
const { fetchTools, loadManifest } = require("../scripts/fetch-tools");

const sha = (data) => crypto.createHash("sha256").update(data).digest("hex");
const quiet = () => {};

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gvl-fetch-tools-"));
  const zip = new AdmZip();
  zip.addFile("pkg/bin/tool-a.exe", Buffer.from("tool a"));
  zip.addFile("pkg/bin/tool-b.exe", Buffer.from("tool b"));
  const zipBuffer = zip.toBuffer();
  const sources = {
    "https://example.test/pkg.zip": zipBuffer,
    "https://example.test/single.exe": Buffer.from("single"),
  };
  const manifest = {
    tools: [
      {
        name: "Pkg", version: "1", url: "https://example.test/pkg.zip", sha256: sha(zipBuffer),
        files: [
          { name: "tool-a.exe", entry: "pkg/bin/tool-a.exe", sha256: sha("tool a") },
          { name: "tool-b.exe", entry: "pkg/bin/tool-b.exe", sha256: sha("tool b") },
        ],
      },
      {
        name: "Single", version: "1", url: "https://example.test/single.exe", sha256: sha("single"),
        files: [{ name: "single.exe", sha256: sha("single") }],
      },
    ],
  };
  const requested = [];
  const downloader = async (url, dest) => {
    requested.push(url);
    fs.writeFileSync(dest, sources[url]);
  };
  return { dir, binDir: path.join(dir, "bin"), manifest, sources, downloader, requested };
}

test("the real manifest pins https sources and every bundled binary", () => {
  const manifest = loadManifest();
  const names = manifest.tools.flatMap((tool) => tool.files.map((file) => file.name)).sort();
  assert.deepEqual(names, ["ffmpeg.exe", "ffprobe.exe", "node.exe", "yt-dlp.exe"]);
});

test("fetches, verifies and then skips tools that are already in place", async () => {
  const f = fixture();
  try {
    assert.deepEqual(await fetchTools({ ...f, log: quiet }), []);
    assert.equal(fs.readFileSync(path.join(f.binDir, "tool-b.exe"), "utf8"), "tool b");
    assert.equal(f.requested.length, 2);
    assert.deepEqual(await fetchTools({ ...f, log: quiet }), []);
    assert.equal(f.requested.length, 2, "nothing is downloaded again");
    assert.deepEqual(fs.readdirSync(f.binDir).sort(), ["single.exe", "tool-a.exe", "tool-b.exe"]);
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("a tampered download is rejected and leaves bin untouched", async () => {
  const f = fixture();
  try {
    f.sources["https://example.test/single.exe"] = Buffer.from("evil");
    await assert.rejects(fetchTools({ ...f, log: quiet }), /Single: download sha256/);
    assert.equal(fs.existsSync(path.join(f.binDir, "single.exe")), false);
    assert.deepEqual(fs.readdirSync(f.binDir).filter((name) => name.startsWith(".fetch")), []);
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("check mode reports stale and stray files without downloading", async () => {
  const f = fixture();
  try {
    await fetchTools({ ...f, log: quiet });
    fs.writeFileSync(path.join(f.binDir, "tool-a.exe"), "changed");
    fs.writeFileSync(path.join(f.binDir, "leftover.tmp"), "x");
    const problems = await fetchTools({ ...f, check: true, log: quiet });
    assert.deepEqual(problems, ["tool-a.exe", "unexpected bin/leftover.tmp"]);
    assert.equal(f.requested.length, 2);
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});
