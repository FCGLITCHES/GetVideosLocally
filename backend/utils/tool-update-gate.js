"use strict";

// Coordinates tool self-updates with running tool processes.
//
// yt-dlp.exe is a PyInstaller one-file build that keeps lazily reading its
// compressed Python modules from its own executable while it runs. Replacing
// the binary mid-run makes the live process read the new file at the old
// offsets and crash with "Error -3 while decompressing data: incorrect header
// check". So binaries are only swapped when no tool process is alive.
//
// Once a swap is queued it takes priority: running processes finish, new
// processes wait until the swap is done, so a busy queue cannot postpone an
// update forever.
function createToolUpdateGate() {
  let activeCount = 0;
  let updating = null;
  let updatingLabel = null;
  const pendingLabels = [];
  let waitingAcquires = 0;
  let idleWaiters = [];
  let turnWaiters = [];
  const listeners = new Set();

  function snapshot() {
    let phase = "idle";
    if (updating) phase = "installing";
    else if (pendingLabels.length) phase = "waiting";
    return {
      phase,
      tool: updatingLabel || pendingLabels[0] || null,
      activeCount,
      waitingCount: waitingAcquires,
    };
  }

  function emit() {
    const state = snapshot();
    listeners.forEach((listener) => {
      try {
        listener(state);
      } catch {
        // A broken listener must not break process accounting.
      }
    });
  }

  function wake(list) {
    list.forEach((resolve) => resolve());
  }

  function notifyIdle() {
    const waiters = idleWaiters;
    idleWaiters = [];
    wake(waiters);
  }

  function notifyTurn() {
    const waiters = turnWaiters;
    turnWaiters = [];
    wake(waiters);
  }

  // Reserve a slot before spawning a tool process. Resolves with an
  // idempotent release function to call once the process has exited.
  async function acquire() {
    if (updating || pendingLabels.length) {
      waitingAcquires += 1;
      emit();
      try {
        while (updating || pendingLabels.length) {
          await new Promise((resolve) => turnWaiters.push(resolve));
        }
      } finally {
        waitingAcquires -= 1;
      }
    }
    activeCount += 1;
    emit();
    let released = false;
    return function release() {
      if (released) return;
      released = true;
      activeCount -= 1;
      if (activeCount === 0) notifyIdle();
      emit();
    };
  }

  // Release the slot when the child process exits or fails to start.
  function releaseOnExit(child, release) {
    child.once("close", release);
    child.once("error", release);
  }

  // Run fn with exclusive access once no tool process is running. New
  // acquires wait from the moment this is called.
  async function runWhenIdle(fn, { label = "tools" } = {}) {
    pendingLabels.push(label);
    emit();
    let dequeued = false;
    const dequeue = () => {
      if (dequeued) return;
      dequeued = true;
      pendingLabels.splice(pendingLabels.indexOf(label), 1);
    };
    try {
      for (;;) {
        while (updating) await updating;
        if (activeCount === 0) break;
        await new Promise((resolve) => idleWaiters.push(resolve));
      }
      dequeue();
      let finish;
      updating = new Promise((resolve) => {
        finish = resolve;
      });
      updatingLabel = label;
      emit();
      try {
        return await fn();
      } finally {
        updating = null;
        updatingLabel = null;
        finish();
      }
    } finally {
      dequeue();
      if (!updating && !pendingLabels.length) notifyTurn();
      emit();
    }
  }

  function onChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return {
    acquire,
    releaseOnExit,
    runWhenIdle,
    onChange,
    getState: snapshot,
    get activeCount() {
      return activeCount;
    },
    get isUpdating() {
      return updating !== null;
    },
    get isPending() {
      return pendingLabels.length > 0;
    },
  };
}

module.exports = { createToolUpdateGate };
