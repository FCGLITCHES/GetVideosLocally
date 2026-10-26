"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_REPORT_ENDPOINT,
  fitDiagnostics,
  resolveReportEndpoint,
  sendProblemReport,
} = require("../backend/services/problem-report");
const { registerApiRoutes } = require("../backend/routes/api-routes");

const silent = { info() {}, warn() {}, error() {} };

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function reportRoute(deps) {
  const routes = new Map();
  const app = { post: (n, fn) => routes.set(n, fn), get: (n, fn) => routes.set(n, fn), delete: (n, fn) => routes.set(n, fn) };
  registerApiRoutes(app, { logger: silent, getToolVersion: async () => "test", getLastUpdateCheck: () => 0, ...deps });
  return routes.get("/api/report-problem");
}

function fakeFetch(status = 202, body = { ok: true, id: "re_123" }) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, payload: JSON.parse(init.body) });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { calls, fetchImpl };
}

test("reports go to the website unless a loopback test endpoint is set", () => {
  assert.equal(resolveReportEndpoint({}), DEFAULT_REPORT_ENDPOINT);
  assert.equal(resolveReportEndpoint({ GVL_REPORT_ENDPOINT: "https://evil.example/r" }), DEFAULT_REPORT_ENDPOINT);
  assert.equal(resolveReportEndpoint({ GVL_REPORT_ENDPOINT: "http://127.0.0.1:9/r" }), "http://127.0.0.1:9/r");
});

test("oversized diagnostics keep the verdict at the top and the system info at the end", () => {
  const text = `VERDICT${"x".repeat(5000)}SYSTEM`;
  const fitted = fitDiagnostics(text, 1000);
  assert.ok(fitted.length <= 1000);
  assert.ok(fitted.startsWith("VERDICT"));
  assert.ok(fitted.endsWith("SYSTEM"));
  assert.match(fitted, /characters removed/);
  assert.equal(fitDiagnostics("short", 1000), "short");
});

test("sendProblemReport posts the trimmed report and returns the mail id", async () => {
  const { calls, fetchImpl } = fakeFetch();
  const result = await sendProblemReport({
    message: "  it broke  ", email: " me@example.com ", diagnostics: "# report",
    appVersion: "3.2.9", channel: "installer", endpoint: "http://127.0.0.1:1/r", fetchImpl,
  });
  assert.deepEqual(result, { ok: true, id: "re_123" });
  assert.deepEqual(calls[0].payload, {
    appVersion: "3.2.9", channel: "installer", email: "me@example.com", message: "it broke", diagnostics: "# report",
  });
});

test("sendProblemReport validates before sending and explains server refusals", async () => {
  const { calls, fetchImpl } = fakeFetch();
  await assert.rejects(sendProblemReport({ message: " ", fetchImpl }), { status: 400 });
  await assert.rejects(sendProblemReport({ message: "x", email: "nope", fetchImpl }), { status: 400 });
  assert.equal(calls.length, 0);

  await assert.rejects(
    sendProblemReport({ message: "x", appVersion: "3.2.9", fetchImpl: fakeFetch(429).fetchImpl }),
    { status: 429, message: /Too many reports/ },
  );
  await assert.rejects(
    sendProblemReport({ message: "x", appVersion: "3.2.9", fetchImpl: async () => { throw new TypeError("fetch failed"); } }),
    { status: 502, message: /Could not reach/ },
  );
});

test("the route only builds diagnostics when the user consented", async () => {
  const sent = [];
  let collected = 0;
  const route = reportRoute({
    collectDiagnostics: async ({ renderer }) => { collected += 1; return { text: `report for ${renderer?.activeTab}` }; },
    sendProblemReport: async (report) => { sent.push(report); return { ok: true, id: "re_1" }; },
  });

  const withoutConsent = response();
  await route({ body: { message: "broke", includeDiagnostics: false } }, withoutConsent);
  assert.equal(withoutConsent.statusCode, 200);
  assert.equal(withoutConsent.body.diagnosticsIncluded, false);
  assert.equal(collected, 0);
  assert.equal(sent[0].diagnostics, null);

  const withConsent = response();
  await route({ body: { message: "broke", includeDiagnostics: true, renderer: { activeTab: "youtube" } } }, withConsent);
  assert.equal(withConsent.body.diagnosticsIncluded, true);
  assert.equal(collected, 1);
  assert.equal(sent[1].diagnostics, "report for youtube");

  const bad = response();
  await route({ body: { message: "broke", includeDiagnostics: "yes" } }, bad);
  assert.equal(bad.statusCode, 400);
  assert.equal(sent.length, 2);
});

test("the route passes relay failures through with their status", async () => {
  const route = reportRoute({
    sendProblemReport: async () => { const e = new Error("Too many reports"); e.status = 429; throw e; },
  });
  const res = response();
  await route({ body: { message: "broke" } }, res);
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.error, "Too many reports");
});
