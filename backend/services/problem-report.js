"use strict";

// "Report a problem": relays the user's message, and the diagnostics report
// when they agree to include it, to the website, which emails support. The
// mail service key lives only on the website, never in the app.

const { tr, uiMessage, uiException } = require("../utils/ui-message");

const DEFAULT_REPORT_ENDPOINT = "https://getvideoslocally.com/api/app/report";
const MESSAGE_MAX_CHARS = 5000;
// The site accepts up to 1.5M characters. Keep headroom for the JSON envelope.
const DIAGNOSTICS_MAX_CHARS = 1_400_000;
const EMAIL_PATTERN = /^[^\s<>"'@]+@[^\s<>"'@]+\.[^\s<>"'@]+$/;

function isLoopbackUrl(value) {
  try {
    const url = new URL(value);
    return ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

// A local override exists for testing only. Reports never go anywhere but the
// GetVideosLocally website.
function resolveReportEndpoint(env = process.env) {
  const override = String(env.GVL_REPORT_ENDPOINT || "").trim();
  return override && isLoopbackUrl(override) ? override : DEFAULT_REPORT_ENDPOINT;
}

// The verdict and detected issues sit at the top and the system section at
// the end, so an oversized report keeps both ends.
function fitDiagnostics(text, limit = DIAGNOSTICS_MAX_CHARS) {
  const value = String(text || "");
  if (value.length <= limit) return value;
  const marker = `\n\n[... ${value.length - limit} characters removed to fit the report size limit ...]\n\n`;
  const keep = limit - marker.length;
  const head = Math.ceil(keep * 0.75);
  return value.slice(0, head) + marker + value.slice(value.length - (keep - head));
}

function validateReportInput({ message, email } = {}) {
  if (typeof message !== "string" || !message.trim()) {
    return { message: tr("Describe what went wrong.") };
  }
  if (message.trim().length > MESSAGE_MAX_CHARS) {
    return uiMessage("Keep the description under {max} characters.", { max: MESSAGE_MAX_CHARS });
  }
  if (email !== undefined && email !== null && email !== "") {
    if (typeof email !== "string" || email.length > 254 || !EMAIL_PATTERN.test(email.trim())) {
      return { message: tr("Enter a valid email address, or leave it empty.") };
    }
  }
  return null;
}

async function sendProblemReport({
  message,
  email = "",
  diagnostics = null,
  appVersion,
  channel,
  endpoint = resolveReportEndpoint(),
  fetchImpl = globalThis.fetch,
  timeoutMs = 30000,
}) {
  const invalid = validateReportInput({ message, email });
  if (invalid) {
    const error = uiException(invalid);
    error.status = 400;
    throw error;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        appVersion,
        channel,
        email: email ? email.trim() : null,
        message: message.trim(),
        diagnostics: diagnostics ? fitDiagnostics(diagnostics) : null,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    const failure = new Error(
      error.name === "AbortError"
        ? tr("Sending timed out. Check your connection and try again.")
        : tr("Could not reach getvideoslocally.com. Check your connection and try again."),
    );
    failure.status = 502;
    throw failure;
  } finally {
    clearTimeout(timer);
  }

  if (response.ok) {
    const body = await response.json().catch(() => ({}));
    return { ok: true, id: body.id || null };
  }
  const failure = uiException(
    response.status === 429
      ? { message: tr("Too many reports from this network. Try again in an hour.") }
      : response.status === 413
        ? { message: tr("The report is too large to send. Save the diagnostics file and email it instead.") }
        : uiMessage("The report could not be sent (HTTP {status}). Try again later.", { status: response.status }),
  );
  failure.status = response.status === 429 ? 429 : 502;
  throw failure;
}

module.exports = {
  DEFAULT_REPORT_ENDPOINT,
  DIAGNOSTICS_MAX_CHARS,
  fitDiagnostics,
  resolveReportEndpoint,
  sendProblemReport,
  validateReportInput,
};
