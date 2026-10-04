"use strict";

const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const pendingWrites = new Map();

async function readJsonFile(filePath, fallbackValue = null) {
  if (!filePath) {
    return fallbackValue;
  }

  try {
    const raw = await fs.promises.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      try {
        const backup = await fs.promises.readFile(`${filePath}.bak`, "utf8");
        const recovered = JSON.parse(backup);
        await fs.promises.rename(`${filePath}.bak`, filePath);
        return recovered;
      } catch (backupError) {
        if (backupError.code !== "ENOENT") throw backupError;
      }
      return fallbackValue;
    }
    throw error;
  }
}

async function writeJsonAtomic(filePath, value) {
  if (!filePath) {
    return;
  }

  const serialized =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const key = path.resolve(filePath);
  const previous = pendingWrites.get(key) || Promise.resolve();
  const write = previous.catch(() => {}).then(() => replaceJsonFile(key, serialized));
  pendingWrites.set(key, write);
  try {
    await write;
  } finally {
    if (pendingWrites.get(key) === write) pendingWrites.delete(key);
  }
}

async function replaceJsonFile(filePath, serialized) {
  const directory = path.dirname(filePath);
  const tempFilePath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  const backupPath = `${filePath}.bak`;

  await fs.promises.mkdir(directory, { recursive: true });
  await fs.promises.writeFile(tempFilePath, serialized, "utf8");

  try {
    await fs.promises.rename(tempFilePath, filePath);
    return;
  } catch (error) {
    if (!["EEXIST", "EPERM"].includes(error.code)) {
      await fs.promises.rm(tempFilePath, { force: true }).catch(() => {});
      throw error;
    }
  }

  let backedUp = false;
  try {
    if (fs.existsSync(filePath)) {
      // Never discard an unrecovered backup from an earlier failed save.
      if (fs.existsSync(backupPath)) throw new Error(`Recovery backup exists: ${backupPath}`);
      await fs.promises.rename(filePath, backupPath);
      backedUp = true;
    }
    await fs.promises.rename(tempFilePath, filePath);
    if (backedUp) await fs.promises.rm(backupPath, { force: true });
  } catch (error) {
    if (backedUp && !fs.existsSync(filePath)) {
      await fs.promises.rename(backupPath, filePath).catch(() => {});
    }
    throw error;
  } finally {
    await fs.promises.rm(tempFilePath, { force: true }).catch(() => {});
  }
}

module.exports = {
  readJsonFile,
  writeJsonAtomic,
};
