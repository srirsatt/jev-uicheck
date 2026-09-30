import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluatePageHealth } from '../dist/checks/universal.js';
import { combinedExitCode, formatCombinedReport } from '../dist/report.js';

function report() {
  return {
    health: evaluatePageHealth({
      status: 'captured', requestedUrl: 'http://localhost/login',
      state: { url: 'http://localhost/login', title: 'Login', ariaSnapshot: '- heading "Login"', capturedAt: 'now' },
      evidence: { events: [], droppedEvents: 0 },
      timingsMs: { navigation: 10, readiness: 5, snapshot: 5, total: 20 },
    }),
    jev: {
      status: 'evaluated', mode: 'advisory', durationMs: 250,
      evidenceState: '{\n  "before:L2": "button Log in",\n  "after:L2": "checkbox Remember me"\n}',
      response: {
        model: 'jev-1.13.0', usage: { input_tokens: 100, output_tokens: 20 },
        answers: {
          intent: { type: 'choice', choice: 'satisfied', probabilities: { satisfied: 0.55, violated: 0.2, insufficient_evidence: 0.25 }, confidence: 0.32 },
          unexpectedChanges: { type: 'choice', choice: 'violated', probabilities: { satisfied: 0, violated: 1, insufficient_evidence: 0 }, confidence: 1 },
          regression: { type: 'choice', choice: 'insufficient_evidence', probabilities: { satisfied: 0.01, violated: 0.1, insufficient_evidence: 0.89 }, confidence: 0.84 },
        },
      },
    },
    timingsMs: { total: 280, diff: 1, jev: 250 },
  };
}

test('combined output preserves raw advisory choices and confidence without relabeling them as passes/failures', () => {
  const result = report();
  const text = formatCombinedReport(result);
  assert.match(text, /UI health — 6 passed, 0 failed, 0 uncertain/);
  assert.match(text, /\? Prompt intent: satisfied \(probability 0\.550, confidence 0\.320\)/);
  assert.match(text, /\? Unexpected changes: violated/);
  assert.match(text, /\? Regression: insufficient evidence/);
  assert.ok(!text.includes('✗ Unexpected changes'));
  assert.equal(combinedExitCode(result), 0);
});

test('Jev cannot override health exit codes, including when unavailable or skipped', () => {
  const result = report();
  for (const [status, expectedCode] of [['pass', 0], ['fail', 1], ['uncertain', 2]]) {
    result.health.status = status;
    for (const jev of [
      report().jev,
      { status: 'unavailable', mode: 'advisory', reason: 'timeout', message: 'Jev request timed out.', durationMs: 5000 },
      { status: 'skipped', mode: 'advisory', message: 'No BEFORE baseline is available.', durationMs: 0 },
    ]) {
      result.jev = jev;
      assert.equal(combinedExitCode(result), expectedCode);
      const text = formatCombinedReport(result);
      assert.match(text, /browser health only; Jev is advisory/);
      if (jev.status !== 'evaluated') {
        assert.ok(text.includes(jev.message));
        assert.match(text, /not a semantic pass/);
      }
    }
  }
});

test('full input evidence is available on demand without inventing per-answer citations', () => {
  const result = report();
  const original = structuredClone(result);
  assert.ok(!formatCombinedReport(result).includes('before:L2'));
  const text = formatCombinedReport(result, { includeEvidence: true });
  assert.match(text, /before:L2/);
  assert.match(text, /after:L2/);
  assert.match(text, /not per-answer citations/);
  assert.deepEqual(result, original);
});

test('model labels, unavailable messages, and evidence cannot inject terminal control characters', () => {
  const result = report();
  result.jev.response.model = 'jev\u001b[2J\nspoof';
  result.jev.evidenceState += '\u001b[2J';
  assert.ok(!formatCombinedReport(result, { includeEvidence: true }).includes('\u001b'));
  result.jev = { status: 'unavailable', mode: 'advisory', reason: 'network', message: 'error\u001b[2J', durationMs: 1 };
  assert.ok(!formatCombinedReport(result).includes('\u001b'));
});
