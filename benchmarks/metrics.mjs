export const labels = ['satisfied', 'violated', 'insufficient_evidence'];

// Wilson 95% interval: include the sample count and avoid implying 0/N means zero risk.
export function rate(count, total) {
  if (!Number.isInteger(count) || !Number.isInteger(total) || count < 0 || total < count) throw new Error('Invalid counts');
  if (total === 0) return { count, total, fraction: null, interval95: null };
  const fraction = count / total;
  const z = 1.959963984540054;
  const divisor = 1 + z * z / total;
  const center = (fraction + z * z / (2 * total)) / divisor;
  const margin = z * Math.sqrt(fraction * (1 - fraction) / total + z * z / (4 * total * total)) / divisor;
  return { count, total, fraction, interval95: [Math.max(0, center - margin), Math.min(1, center + margin)] };
}

export function latency(values) {
  if (values.some((value) => !Number.isFinite(value) || value < 0)) throw new Error('Invalid timing');
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return { count: 0, medianMs: null, p95Ms: null, minMs: null, maxMs: null };
  const n = sorted.length;
  return { count: n, medianMs: (sorted[Math.floor((n - 1) / 2)] + sorted[Math.floor(n / 2)]) / 2,
    p95Ms: sorted[Math.ceil(n * 0.95) - 1], minMs: sorted[0], maxMs: sorted[n - 1] };
}

/** One row per unique case. Repeated runs must not inflate the accuracy sample. */
export function judgments(rows) {
  const n = rows.length;
  const count = (predicate) => rows.filter(predicate).length;
  const isDecision = (row) => row.actual === 'satisfied' || row.actual === 'violated';
  const observed = rows.filter((row) => labels.includes(row.actual));
  const violations = count((r) => r.expected === 'violated');
  const valid = count((r) => r.expected === 'satisfied');
  const unobservable = count((r) => r.expected === 'insufficient_evidence');
  const confusion = Object.fromEntries(labels.map((expected) => [expected, Object.fromEntries(
    [...labels, 'unavailable', 'skipped'].map((actual) => [actual, count((r) => r.expected === expected && r.actual === actual)]),
  )]));
  const calibration = observed.filter((r) => r.probabilities);
  const bins = Array.from({ length: 5 }, (_, i) => {
    const members = calibration.filter((r) => Math.min(4, Math.floor(r.probabilities[r.actual] * 5)) === i);
    return { lower: i / 5, upper: (i + 1) / 5, count: members.length,
      meanProbability: members.length ? members.reduce((s, r) => s + r.probabilities[r.actual], 0) / members.length : null,
      accuracy: members.length ? members.filter((r) => r.actual === r.expected).length / members.length : null };
  });
  return {
    cases: n,
    exactAgreement: rate(count((r) => r.actual === r.expected), n),
    falsePass: rate(count((r) => r.expected === 'violated' && r.actual === 'satisfied'), violations),
    violationDetection: rate(count((r) => r.expected === 'violated' && r.actual === 'violated'), violations),
    missedViolationIncludingAbstention: rate(count((r) => r.expected === 'violated' && r.actual !== 'violated'), violations),
    falseFailure: rate(count((r) => r.expected === 'satisfied' && r.actual === 'violated'), valid),
    uncertain: rate(count((r) => r.actual === 'insufficient_evidence'), n),
    unavailable: rate(count((r) => r.actual === 'unavailable' || r.actual === 'skipped'), n),
    decisionCoverage: rate(count(isDecision), n),
    selectiveAccuracy: rate(count((r) => isDecision(r) && r.actual === r.expected), count(isDecision)),
    unsupportedCertainty: rate(count((r) => r.expected === 'insufficient_evidence' && isDecision(r)), unobservable),
    confusion,
    calibration: {
      count: calibration.length,
      multiclassBrier: calibration.length ? calibration.reduce((s, r) => s + labels.reduce(
        (sum, label) => sum + (r.probabilities[label] - Number(label === r.expected)) ** 2, 0), 0) / calibration.length : null,
      ece5: calibration.length ? bins.reduce((s, b) => s + (b.count ? b.count / calibration.length * Math.abs(b.meanProbability - b.accuracy) : 0), 0) : null,
      bins,
    },
  };
}
