"use strict";

function isLocalOrigin(origin, port) {
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "http:" &&
      ["127.0.0.1", "localhost"].includes(parsed.hostname) &&
      Number(parsed.port || 80) === Number(port) && /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(origin);
  } catch {
    return false;
  }
}

function createLocalRequestGuard(port) {
  return (req, res, next) => {
    if (!isLocalOrigin(`http://${req.headers.host}`, port) ||
        (req.headers.origin && !isLocalOrigin(req.headers.origin, port))) {
      return res.status(403).json({ error: "Forbidden origin" });
    }
    next();
  };
}

module.exports = { isLocalOrigin, createLocalRequestGuard };
