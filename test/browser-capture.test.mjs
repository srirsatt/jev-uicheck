import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { captureBefore, captureAfter, runCombinedCheck, runHealthCheck, runPageCapture } from '../dist/runner.js';
import { combinedExitCode, formatCombinedReport } from '../dist/report.js';
import { BaselineStore } from '../dist/store.js';

test('captures real browser failures, handles timeouts, and isolates repeated runs', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    // All requests stay local to Playwright: no server or external service needed.
    await page.route('http://fixture.test/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/offline') return route.abort('connectionrefused');
      if (path === '/api') return route.fulfill({ status: 503, body: 'Unavailable' });
      if (path === '/clean') {
        return route.fulfill({ contentType: 'text/html', body: '<h1>Clean page</h1>' });
      }
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><title>Broken fixture</title>
          <script>
            console.error('Fixture console error');
            throw new Error('Fixture uncaught error');
          </script>
          <script>
            Promise.allSettled([fetch('/api'), fetch('/offline')]).then(() => {
              document.body.innerHTML = '<h1>Ready</h1><button>Log in</button>';
            });
          </script><body></body>`,
      });
    });

    const eventNames = ['console', 'pageerror', 'requestfailed', 'response'];
    const listenerCounts = () => eventNames.map((name) => page.listenerCount(name));
    const originalCounts = listenerCounts();
    const { capture: result, report } = await runHealthCheck(page, {
      url: 'http://fixture.test/broken',
      ready: page.getByRole('heading', { name: 'Ready', exact: true }),
    });
    assert.equal(result.status, 'captured');
    assert.match(result.state.ariaSnapshot, /button "Log in"/);
    assert.equal(result.state.title, 'Broken fixture');
    const events = result.evidence.events;
    assert.ok(events.some((e) => e.kind === 'console-error' && e.message === 'Fixture console error'));
    assert.ok(events.some((e) => e.kind === 'page-error' && e.message === 'Fixture uncaught error'));
    assert.ok(events.some((e) => e.kind === 'http-error' && e.status === 503 && e.url.endsWith('/api')));
    assert.ok(events.some((e) => e.kind === 'request-failed' && e.url.endsWith('/offline')));
    assert.ok(!events.some((e) => e.kind === 'request-failed' && e.url.endsWith('/api')));
    assert.equal(report.status, 'fail');
    assert.equal(report.checks.filter((check) => check.status === 'fail').length, 4);
    assert.deepEqual(listenerCounts(), originalCounts);
    assert.ok(Object.values(result.timingsMs).every((ms) => ms >= 0));

    const incomplete = await runPageCapture(page, {
      url: 'http://fixture.test/clean',
      ready: page.getByRole('heading', { name: 'Missing heading' }),
      timeoutMs: 1_000,
    });
    assert.equal(incomplete.status, 'incomplete');
    assert.equal(incomplete.error.stage, 'readiness');
    assert.ok(!('state' in incomplete));
    assert.deepEqual(listenerCounts(), originalCounts);

    const clean = await runPageCapture(page, {
      url: 'http://fixture.test/clean',
      ready: page.getByRole('heading', { name: 'Clean page' }),
    });
    assert.equal(clean.status, 'captured');
    assert.deepEqual(clean.evidence, { events: [], droppedEvents: 0 });
    assert.deepEqual(listenerCounts(), originalCounts);
  } finally {
    await browser.close();
  }
});

test('BEFORE survives edits and repairs, while missing or failed captures stay explicit', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jev-comparison-'));
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    let controls = '<button>Log in</button>';
    await page.route('http://fixture.test/**', (route) => route.fulfill({
      contentType: 'text/html', body: `<h1>Login</h1>${controls}`,
    }));
    const store = new BaselineStore(directory);
    const key = { taskId: 'prompt-1', checkpointId: 'desktop-logged-out', url: 'http://fixture.test/login' };
    const options = { ready: page.getByRole('heading', { name: 'Login', exact: true }) };
    const before = await captureBefore(page, store, key, 'Add remember me', options);
    assert.equal(before.status, 'saved');

    controls = '<label><input type="checkbox">Remember me</label>'; // Accidentally removed login.
    let jevCalls = 0;
    const jevOptions = {
      apiKey: 'test-only-key',
      fetchImpl: async (_url, request) => {
        jevCalls++;
        const input = JSON.parse(request.body);
        assert.ok(input.state.includes('Remember me'));
        return Response.json({
          model: 'jev-1.13.0', usage: { input_tokens: 100, output_tokens: 20 },
          answers: Object.fromEntries(Object.keys(input.questions).map((id) => [id, {
            type: 'choice', choice: 'violated', confidence: 1,
            probabilities: { satisfied: 0, violated: 1, insufficient_evidence: 0 },
          }])),
        });
      },
    };
    const { comparison: broken, report: combined } = await runCombinedCheck(page, store, key, options, jevOptions);
    assert.equal(jevCalls, 1);
    assert.equal(combined.health.status, 'pass');
    assert.equal(combined.jev.status, 'evaluated');
    assert.equal(combinedExitCode(combined), 0); // Even a certain model violation is advisory.
    assert.equal(combined.jev.evidenceState, broken.intent.request.state);
    assert.match(formatCombinedReport(combined), /\? Prompt intent: violated/);
    assert.ok(combined.timingsMs.total >= combined.timingsMs.jev);
    assert.equal(broken.status, 'compared');
    assert.equal(broken.intent.status, 'ready');
    assert.equal(JSON.parse(broken.intent.request.state).user_request, 'Add remember me');
    assert.ok(broken.diff.changes.some((change) => change.before.some((line) => line.text.includes('button "Log in"'))));
    const repeated = await captureBefore(page, store, key, 'Add remember me', options);
    assert.equal(repeated.status, 'existing');
    assert.deepEqual(repeated.baseline, before.baseline);

    controls += '<button>Log in</button>'; // Repair restores the original control.
    const repaired = await captureAfter(page, store, key, options);
    assert.equal(repaired.status, 'compared');
    assert.deepEqual(repaired.baseline, before.baseline);
    assert.ok(repaired.diff.changes.every((change) => change.kind === 'added'));
    assert.ok(repaired.diff.changes.some((change) => change.after.some((line) => line.text.includes('Remember me'))));

    const lateKey = { ...key, url: 'http://fixture.test/new-route' };
    const { comparison: late, report: lateReport } = await runCombinedCheck(page, store, lateKey, options, jevOptions);
    assert.equal(jevCalls, 1); // Missing baseline must not produce a model request.
    assert.equal(lateReport.jev.status, 'skipped');
    assert.equal(late.status, 'no-baseline');
    assert.equal(late.intent.status, 'cannot-evaluate');
    assert.equal(late.intent.reason, 'no-baseline');
    assert.equal(await store.load(lateKey), undefined);

    const failedKey = { ...key, taskId: 'failed-prompt' };
    const failed = await captureBefore(page, store, failedKey, 'New prompt', {
      ready: page.getByRole('heading', { name: 'Missing' }), timeoutMs: 500,
    });
    assert.equal(failed.status, 'incomplete');
    assert.equal(await store.load(failedKey), undefined);

    const incompleteRun = await runCombinedCheck(page, store, key, {
      ready: page.getByRole('heading', { name: 'Missing' }), timeoutMs: 100,
    }, jevOptions);
    assert.equal(incompleteRun.report.jev.status, 'skipped');
    assert.equal(combinedExitCode(incompleteRun.report), 2);
    assert.equal(jevCalls, 1);
  } finally {
    await browser?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
