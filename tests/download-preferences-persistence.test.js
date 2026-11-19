"use strict";

// Regression: v3.2.10 reset Format, Quality and Concurrent downloads on every
// reload/restart because the main-form pickers were never saved.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.join(__dirname, "..");
const rendererSource = fs.readFileSync(path.join(projectRoot, "script.js"), "utf8");
const mainSource = fs.readFileSync(path.join(projectRoot, "electron-main.js"), "utf8");
const preloadSource = fs.readFileSync(path.join(projectRoot, "preload.js"), "utf8");

test("format_and_quality_changes_are_saved_immediately", () => {
  assert.match(
    rendererSource,
    /formatSelect\.addEventListener\('change',[\s\S]{0,300}persistDownloadPreferences\(\{\s*defaultFormat: formatSelect\.value,\s*defaultQuality: qualitySelect\.value/,
  );
  assert.match(
    rendererSource,
    /qualitySelect\.addEventListener\('change',[\s\S]{0,120}persistDownloadPreferences\(\{ defaultQuality: qualitySelect\.value \}\)/,
  );
});

test("both_concurrency_pickers_are_restored_and_saved", () => {
  assert.match(rendererSource, /defaultConcurrency: '1'/);
  assert.match(rendererSource, /playlistConcurrency: '3'/);
  assert.match(rendererSource, /singleConcurrencyPicker\.value = String\(userSettings\.defaultConcurrency\)/);
  assert.match(rendererSource, /persistDownloadPreferences\(\{ defaultConcurrency: singleConcurrencyPicker\.value \}\)/);
  assert.match(rendererSource, /playlistConcurrencySelect\.value = String\(userSettings\.playlistConcurrency\)/);
  assert.match(rendererSource, /persistDownloadPreferences\(\{ playlistConcurrency: playlistConcurrencySelect\.value \}\)/);
});

test("saving_the_settings_modal_keeps_preferences_it_does_not_own", () => {
  assert.match(
    rendererSource,
    /userSettings = \{\s*\/\/ Keep every saved preference[^\n]*\n\s*\.\.\.userSettings,\s*maxSpeed:/,
  );
});

test("settings_writes_are_flushed_to_disk", () => {
  assert.doesNotMatch(rendererSource, /localStorage\.setItem\('ytdUserSettings', JSON\.stringify\(userSettings\)\)/);
  assert.match(rendererSource, /function saveUserSettingsToStorage[\s\S]{0,160}flushSettingsToDisk\(\)/);
  assert.match(preloadSource, /flushStorageData: \(\) => ipcRenderer\.invoke\("flush-storage-data"\)/);
  assert.match(mainSource, /ipcMain\.handle\('flush-storage-data', \(event\) => \{\s*assertTrustedIpcSender\(event\);/);
  assert.match(mainSource, /session\.defaultSession\.flushStorageData\(\)/);
  assert.match(mainSource, /app\.on\('before-quit', \(event\) => \{\s*flushRendererStorage\(\);/);
});

test("remember-last-choices toggle gates saving and is offered in setup and Settings", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(renderer, /rememberDownloadChoices: true/);
  assert.match(renderer, /function persistDownloadPreferences\(patch\) \{\s*if \(!shouldRememberDownloadChoices\(\)\) return;/);
  assert.match(renderer, /id="onboardingRememberChoices"/);
  assert.match(renderer, /persistOnboardingSettings\(\{ rememberDownloadChoices: onboardingState\.rememberChoices \}\)/);
  assert.match(renderer, /rememberDownloadChoices: rememberDownloadChoicesCheckbox \? rememberDownloadChoicesCheckbox\.checked/);
  assert.match(renderer, /rememberDownloadChoicesCheckbox\.checked = userSettings\.rememberDownloadChoices !== false/);
  assert.match(html, /id="rememberDownloadChoices"/);
});
