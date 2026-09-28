const test = require('node:test');
const assert = require('node:assert/strict');
const { createDownloadDismissals } = require('../public/download-dismissals');

function storage() {
    const values = new Map();
    return { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
}

test('X remains dismissed after a failed request and reload, then syncs on reconnection', async () => {
    const saved = storage();
    const first = createDownloadDismissals({ storage: saved, clientId: 'client', removeRemote: async () => { throw new TypeError('Failed to fetch'); } });
    first.dismiss('video');
    assert.equal(await first.flush(), 1);
    const removed = [];
    const restarted = createDownloadDismissals({ storage: saved, clientId: 'client', removeRemote: async id => removed.push(id) });
    assert.equal(restarted.dismissed.has('video'), true);
    assert.equal(await restarted.flush(), 0);
    assert.deepEqual(removed, ['video']);
    assert.equal(restarted.dismissed.has('video'), true, 'late events must not recreate the card');
    assert.deepEqual(JSON.parse(saved.getItem('gvl_pendingRemovals:client')), []);
});

test('a lost response after server deletion is safe to retry', async () => {
    const jobs = new Set(['video']);
    let calls = 0;
    const queue = createDownloadDismissals({ storage: storage(), clientId: 'client', removeRemote: async id => {
        jobs.delete(id);
        if (++calls === 1) throw new TypeError('Failed to fetch');
    } });
    queue.dismiss('video');
    assert.equal(await queue.flush(), 1);
    assert.equal(jobs.size, 0);
    assert.equal(await queue.flush(), 0);
    assert.equal(queue.dismissed.has('video'), true);
});

test('removing another item during a pending request does not lose its saved dismissal', async () => {
    let finish;
    const queue = createDownloadDismissals({ storage: storage(), clientId: 'client', removeRemote: () => new Promise(resolve => { finish = resolve; }) });
    queue.dismiss('first');
    const request = queue.flush();
    queue.dismiss('second');
    finish();
    assert.equal(await request, 1);
    assert.equal(queue.dismissed.has('second'), true);
});

test('storage errors do not pretend a removal was saved', () => {
    const queue = createDownloadDismissals({ storage: { getItem: () => null, setItem: () => { throw new Error('Storage full'); } }, clientId: 'client', removeRemote: async () => {} });
    assert.throws(() => queue.dismiss('video'), /Storage full/);
    assert.equal(queue.dismissed.has('video'), false);
});
