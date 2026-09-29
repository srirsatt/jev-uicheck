import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BaselineStore } from '../dist/store.js';

test('baseline persists across store instances, survives competing saves, and isolates tasks/routes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jev-store-'));
  try {
    const store = new BaselineStore(directory);
    const key = { taskId: 'task-1', checkpointId: 'desktop-logged-out', url: 'http://localhost:3000/login' };
    const state = { url: key.url, title: 'Login', ariaSnapshot: '- button "Log in"', capturedAt: 'now' };
    assert.equal(await store.load(key), undefined);
    const results = await Promise.all([
      store.save(key, 'Add remember me', state),
      store.save(key, 'Add remember me', { ...state, title: 'Other capture' }),
    ]);
    assert.deepEqual(results.sort(), ['existing', 'saved']);
    const baseline = await new BaselineStore(directory).load(key);
    assert.ok(baseline);
    await store.save(key, 'Add remember me', { ...state, ariaSnapshot: 'broken repair' });
    assert.deepEqual(await store.load(key), baseline);
    assert.equal(await store.load({ ...key, taskId: 'task-2' }), undefined);
    assert.equal(await store.load({ ...key, url: 'http://localhost:3000/reset' }), undefined);
    assert.equal(await store.load({ ...key, checkpointId: 'mobile' }), undefined);
    const files = await readdir(directory);
    assert.equal(files.length, 1); // No temporary files remain after either save.
    await writeFile(join(directory, files[0]), '{"version":99}');
    await assert.rejects(store.load(key), /Invalid baseline/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
