"use strict";

function parsePort(rawPort, logger = console) {
  if (rawPort === undefined || rawPort === null || rawPort === "") {
    return 9875;
  }

  const parsedPort = /^\d+$/.test(String(rawPort)) ? Number(rawPort) : NaN;
  if (Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65535) {
    return parsedPort;
  }

  logger.warn?.(
    `[env] Invalid PORT "${rawPort}" provided. Falling back to 9875.`,
  );
  return 9875;
}

function normalizeOptionalString(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function loadEnv(rawEnv = process.env, logger = console) {
  return {
    PORT: parsePort(rawEnv.PORT, logger),
    YTDLP_PATH: normalizeOptionalString(rawEnv.YTDLP_PATH || rawEnv.YTDLPPATH),
    FFMPEG_PATH: normalizeOptionalString(
      rawEnv.FFMPEG_PATH || rawEnv.FFMPEGPATH,
    ),
    NODE_BINARY: normalizeOptionalString(rawEnv.NODE_BINARY),
    USER_DATA_PATH: normalizeOptionalString(rawEnv.USER_DATA_PATH),
    RESEND_API_KEY: normalizeOptionalString(rawEnv.RESEND_API_KEY),
    SUPPORT_EMAIL: normalizeOptionalString(rawEnv.SUPPORT_EMAIL),
    NODE_ENV: normalizeOptionalString(rawEnv.NODE_ENV) || "production",
  };
}

module.exports = { loadEnv };
