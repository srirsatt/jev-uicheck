import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import { runPageCapture } from '../dist/runner.js';

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
    const result = await runPageCapture(page, {
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
