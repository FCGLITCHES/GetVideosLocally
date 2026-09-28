const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createDownloadState } = require('../backend/state/download-state');

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gvl-recovery-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const options = {
    stateFile: path.join(dir, 'state.json'), pausedJobsFile: path.join(dir, 'paused.json'),
    failedJobsFile: path.join(dir, 'failed.json'), scheduledJobsFile: path.join(dir, 'scheduled.json'),
    logger: { log() {}, error() {} },
  };
  return { options, state: createDownloadState(options) };
}

test('dismissed failure stays removed after restart even if a legacy file is stale', async t => {
  const { options, state } = await fixture(t);
  state.failedDownloads.set('failed', { clientId: 'client', videoUrl: 'https://example.com/video' });
  await state.saveRuntimeState();
  state.failedDownloads.delete('failed');
  await state.saveRuntimeState();
  await fs.writeFile(options.failedJobsFile, JSON.stringify({ failed: { clientId: 'client' } }));
  const restarted = createDownloadState(options);
  await restarted.loadPausedJobs();
  assert.equal(restarted.failedDownloads.size, 0);
});

test('cancelled active jobs cannot become recoverable after restart', async t => {
  const { options, state } = await fixture(t);
  state.activeProcesses.set('cancelled', { cancelled: true, itemData: { clientId: 'client' } });
  state.activeProcesses.set('interrupted', { itemData: { clientId: 'client', videoUrl: 'https://example.com/video' } });
  await state.saveRuntimeState();
  const restarted = createDownloadState(options);
  await restarted.loadPausedJobs();
  assert.equal(restarted.pausedDownloads.has('cancelled'), false);
  assert.equal(restarted.pausedDownloads.has('interrupted'), true);
});

test('pending queued work restores as a resumable item instead of an invisible queue entry', async t => {
  const { options, state } = await fixture(t);
  state.downloadQueue.set('queued', { clientId: 'client', videoUrl: 'https://example.com/video', title: 'Video' });
  await state.saveRuntimeState();
  const restarted = createDownloadState(options);
  await restarted.loadPausedJobs();
  assert.equal(restarted.downloadQueue.size, 0);
  assert.equal(restarted.pausedDownloads.get('queued').videoUrl, 'https://example.com/video');
});

test('overlapping saves cannot restore a removed failed item', async t => {
  const { options, state } = await fixture(t);
  state.failedDownloads.set('failed', { clientId: 'client' });
  const firstSave = state.saveRuntimeState();
  state.failedDownloads.delete('failed');
  await Promise.all([firstSave, state.saveRuntimeState()]);
  const restarted = createDownloadState(options);
  await restarted.loadPausedJobs();
  assert.equal(restarted.failedDownloads.size, 0);
});

test('a failure saved before worker cleanup restores only one failed item', async t => {
  const { options, state } = await fixture(t);
  const item = { clientId: 'client', videoUrl: 'https://example.com/video' };
  state.activeProcesses.set('failed', { itemData: item });
  state.failedDownloads.set('failed', item);
  await state.saveRuntimeState();
  const restarted = createDownloadState(options);
  await restarted.loadPausedJobs();
  assert.equal(restarted.failedDownloads.size, 1);
  assert.equal(restarted.pausedDownloads.size, 0);
});
