const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createToolUpdateGate } = require("../backend/utils/tool-update-gate");

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("tool update waits for a running yt-dlp process to exit", async () => {
  const gate = createToolUpdateGate();
  const child = new EventEmitter();
  gate.releaseOnExit(child, await gate.acquire());

  let updated = false;
  const update = gate.runWhenIdle(async () => { updated = true; });
  await tick();
  assert.equal(updated, false, "binary must not be swapped mid-download");

  child.emit("close", 0);
  await update;
  assert.equal(updated, true);
  assert.equal(gate.activeCount, 0);
});

test("new tool processes wait while an update is swapping binaries", async () => {
  const gate = createToolUpdateGate();
  let finishUpdate;
  const update = gate.runWhenIdle(() => new Promise((resolve) => { finishUpdate = resolve; }));
  await tick();
  assert.equal(gate.isUpdating, true);

  let acquired = false;
  const slot = gate.acquire().then((release) => { acquired = true; return release; });
  await tick();
  assert.equal(acquired, false);

  finishUpdate();
  await update;
  (await slot)();
  assert.equal(acquired, true);
  assert.equal(gate.activeCount, 0);
});

test("release is idempotent across close and error events", async () => {
  const gate = createToolUpdateGate();
  const child = new EventEmitter();
  gate.releaseOnExit(child, await gate.acquire());
  const other = await gate.acquire();
  child.emit("error", new Error("spawn ENOENT"));
  child.emit("close", -1);
  assert.equal(gate.activeCount, 1);
  other();
  assert.equal(gate.activeCount, 0);
});

test("a queued update blocks new downloads so it cannot be postponed forever", async () => {
  const gate = createToolUpdateGate();
  const running = new EventEmitter();
  gate.releaseOnExit(running, await gate.acquire());

  const order = [];
  const update = gate.runWhenIdle(async () => { order.push("update"); }, { label: "yt-dlp" });
  await tick();
  assert.equal(gate.getState().phase, "waiting");
  assert.equal(gate.getState().tool, "yt-dlp");

  const next = gate.acquire().then((release) => { order.push("next download"); release(); });
  await tick();
  assert.deepEqual(order, [], "queued download waits behind the pending update");
  assert.equal(gate.getState().waitingCount, 1);

  running.emit("close", 0);
  await Promise.all([update, next]);
  assert.deepEqual(order, ["update", "next download"]);
  assert.equal(gate.getState().phase, "idle");
});

test("change listeners see waiting, installing and idle phases", async () => {
  const gate = createToolUpdateGate();
  const phases = [];
  gate.onChange((state) => {
    if (phases[phases.length - 1] !== state.phase) phases.push(state.phase);
  });
  const release = await gate.acquire();
  const update = gate.runWhenIdle(async () => {}, { label: "ffmpeg" });
  await tick();
  release();
  await update;
  assert.deepEqual(phases, ["idle", "waiting", "installing", "idle"]);
});

test("a failing update still lets waiting downloads start", async () => {
  const gate = createToolUpdateGate();
  const update = gate.runWhenIdle(async () => { throw new Error("swap failed"); });
  const slot = gate.acquire();
  await assert.rejects(update, /swap failed/);
  (await slot)();
  assert.equal(gate.getState().phase, "idle");
});
