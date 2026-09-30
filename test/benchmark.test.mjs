import assert from 'node:assert/strict';
import test from 'node:test';
import { judgments, latency, rate } from '../benchmarks/metrics.mjs';
import { semanticCases, healthCases } from '../benchmarks/cases.mjs';

test('benchmark distinguishes false passes, missed violations, abstentions, and coverage', () => {
  const pairs = [['satisfied', 'satisfied'], ['violated', 'satisfied'], ['violated', 'insufficient_evidence'],
    ['satisfied', 'violated'], ['insufficient_evidence', 'insufficient_evidence'], ['insufficient_evidence', 'satisfied']];
  const result = judgments(pairs.map(([expected, actual]) => ({ expected, actual })));
  assert.equal(result.exactAgreement.count, 2);
  assert.equal(result.falsePass.fraction, 0.5);
  assert.equal(result.missedViolationIncludingAbstention.fraction, 1);
  assert.equal(result.falseFailure.fraction, 0.5);
  assert.equal(result.uncertain.count, 2);
  assert.equal(result.decisionCoverage.count, 4);
  assert.equal(result.selectiveAccuracy.fraction, 0.25);
  assert.equal(result.unsupportedCertainty.fraction, 0.5);
});

test('provider failures stay in denominators rather than disappearing from the benchmark', () => {
  const result = judgments([{ expected: 'violated', actual: 'unavailable' }, { expected: 'satisfied', actual: 'skipped' }]);
  assert.equal(result.exactAgreement.fraction, 0);
  assert.equal(result.unavailable.fraction, 1);
  assert.equal(result.falsePass.fraction, 0);
  assert.equal(result.violationDetection.fraction, 0);
  assert.equal(result.selectiveAccuracy.fraction, null);
});

test('calibration uses probabilities rather than the unrelated confidence summary', () => {
  const result = judgments([{ expected: 'violated', actual: 'satisfied', confidence: 1,
    probabilities: { satisfied: 0.6, violated: 0.3, insufficient_evidence: 0.1 } }]);
  assert.ok(Math.abs(result.calibration.multiclassBrier - 0.86) < 1e-9);
  assert.equal(result.calibration.ece5, 0.6);
});

test('timing percentiles and small-sample uncertainty remain honest', () => {
  assert.deepEqual(latency([4, 1, 3, 2]), { count: 4, medianMs: 2.5, p95Ms: 4, minMs: 1, maxMs: 4 });
  assert.equal(latency([]).medianMs, null);
  assert.throws(() => latency([NaN]));
  assert.equal(rate(0, 0).fraction, null);
  assert.ok(rate(0, 10).interval95[1] > 0.27);
  assert.throws(() => rate(2, 1));
});

test('fixture set contains unique cases, separate families, and predeclared primary labels', () => {
  assert.equal(semanticCases.length, 30);
  assert.equal(new Set(semanticCases.map((c) => c.id)).size, 30);
  assert.equal(semanticCases.filter((c) => c.split === 'evaluation').length, 20);
  for (const c of semanticCases) {
    assert.ok(c.prompt && c.rationale && c.beforeHtml && c.afterHtml);
    assert.ok(['satisfied', 'violated', 'insufficient_evidence'].includes(c.expected));
  }
  assert.equal(healthCases.length, 8);
});
