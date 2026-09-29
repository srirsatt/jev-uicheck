import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluatePageHealth } from '../dist/checks/universal.js';
import { formatHealthReport, healthExitCode } from '../dist/report.js';

function capture(overrides = {}) {
  return {
    status: 'captured', requestedUrl: 'http://localhost:3000/login',
    state: { url: 'http://localhost:3000/login', title: 'Login', ariaSnapshot: '- heading "Login"', capturedAt: 'now' },
    evidence: { events: [], droppedEvents: 0 },
    timingsMs: { navigation: 10, readiness: 5, snapshot: 5, total: 20 },
    ...overrides,
  };
}

test('a completed capture with content and no observed errors passes the health checks', () => {
  const report = evaluatePageHealth(capture());
  assert.equal(report.status, 'pass');
  assert.ok(report.checks.every((check) => check.status === 'pass' && check.evidence.length > 0));
  assert.equal(healthExitCode(report), 0);
});

test('all four error categories fail their check and retain exact source evidence', () => {
  const events = [
    { kind: 'console-error', message: 'Failed to render', url: 'http://localhost/app.js', line: 9 },
    { kind: 'page-error', message: 'Unhandled exception', stack: 'stack trace' },
    { kind: 'request-failed', url: 'http://localhost/api', method: 'POST', reason: 'net::ERR_CONNECTION_REFUSED' },
    { kind: 'http-error', url: 'http://localhost/data', method: 'GET', status: 503 },
  ].map((event) => ({ ...event, observedAt: 'now' }));
  const report = evaluatePageHealth(capture({ evidence: { events, droppedEvents: 0 } }));
  assert.equal(report.status, 'fail');
  assert.equal(healthExitCode(report), 1);
  events.forEach((event, index) => {
    const check = report.checks.find((entry) => entry.id === event.kind);
    assert.equal(check.status, 'fail');
    assert.deepEqual(check.evidence[0], { source: 'browser-event', index: index + 1, event });
  });
  assert.match(formatHealthReport(report), /GET http:\/\/localhost\/data → 503/);
  assert.match(formatHealthReport(report), /app\.js:10/);
});

test('failed capture cannot pass from an empty error list', () => {
  const failed = capture({ status: 'incomplete', error: { stage: 'readiness', message: 'Heading never appeared' } });
  delete failed.state;
  const report = evaluatePageHealth(failed);
  assert.equal(report.status, 'uncertain');
  assert.ok(report.checks.every((check) => check.status === 'uncertain'));
  assert.equal(healthExitCode(report), 2);
  assert.match(formatHealthReport(report), /readiness: Heading never appeared/);
});

test('truncated event collection makes unobserved categories uncertain but preserves observed failures', () => {
  const report = evaluatePageHealth(capture({ evidence: {
    events: [{ kind: 'page-error', message: 'Crash', stack: undefined, observedAt: 'now' }],
    droppedEvents: 12,
  } }));
  assert.equal(report.status, 'fail');
  assert.equal(report.checks.find((check) => check.id === 'page-error').status, 'fail');
  assert.equal(report.checks.find((check) => check.id === 'http-error').status, 'uncertain');
  assert.match(formatHealthReport(report), /12 browser events were omitted/);
});

test('an empty accessibility snapshot remains uncertain even without browser errors', () => {
  const input = capture();
  input.state.ariaSnapshot = '  \n';
  const report = evaluatePageHealth(input);
  assert.equal(report.status, 'uncertain');
  assert.equal(report.checks.find((check) => check.id === 'accessible-content').status, 'uncertain');
});

test('terminal output bounds evidence and strips controls without changing structured evidence', () => {
  const message = 'Crash\n\u001b[2J';
  const events = Array.from({ length: 5 }, () => ({ kind: 'page-error', message, observedAt: 'now' }));
  const report = evaluatePageHealth(capture({ evidence: { events, droppedEvents: 0 } }));
  const text = formatHealthReport(report);
  assert.ok(!text.includes('\u001b'));
  assert.match(text, /2 more evidence entries/);
  const check = report.checks.find((entry) => entry.id === 'page-error');
  assert.equal(check.evidence.length, 5);
  assert.equal(check.evidence[0].event.message, message);
});
