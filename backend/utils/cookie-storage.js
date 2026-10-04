"use strict";

const path = require("node:path");

const YTDLP_COOKIES_DIR_NAME = "ytdlp-cookies";

function getCookiesFilePath(userDataPath) {
  return path.join(userDataPath, YTDLP_COOKIES_DIR_NAME, "cookies.txt");
}

function isValidCookiesText(content) {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (!/^# (?:Netscape )?HTTP Cookie File\b/.test(lines[0])) return false;
  const rows = lines.filter(line => line.trim() && (!line.startsWith("#") || line.startsWith("#HttpOnly_")));
  return rows.length > 0 && rows.every(line => {
    const fields = line.replace(/^#HttpOnly_/, "").split("\t");
    return fields.length === 7 && fields[0] && /^(TRUE|FALSE)$/.test(fields[1]) &&
      fields[2].startsWith("/") && /^(TRUE|FALSE)$/.test(fields[3]) &&
      /^\d*$/.test(fields[4]) && fields[5];
  });
}

module.exports = { getCookiesFilePath, isValidCookiesText, YTDLP_COOKIES_DIR_NAME };
