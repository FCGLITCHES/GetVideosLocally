"use strict";

function assertMediaUrl(value, allowVideoId = false) {
  if (typeof value !== "string" || value.length > 8192 || /[\u0000-\u0020]/.test(value)) {
    throw new TypeError("Enter a valid HTTP or HTTPS video URL.");
  }
  if (allowVideoId && /^[A-Za-z0-9_-]{11}$/.test(value) && !value.startsWith("-")) return value;
  try {
    const parsed = new URL(value);
    if (["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password) return value;
  } catch (_) {}
  throw new TypeError("Enter a valid HTTP or HTTPS video URL.");
}

module.exports = { assertMediaUrl };
