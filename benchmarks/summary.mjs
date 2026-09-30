const percent = (r) => r.fraction === null ? 'N/A' : `${r.count}/${r.total} (${(100 * r.fraction).toFixed(1)}%)`;
const ms = (n) => n === null ? 'N/A' : `${n.toFixed(1)} ms`;

export function renderSummary(s) {
  const lines = [
    '# jev-uicheck-fast — controlled fixture benchmark', '',
    `Run: ${s.manifest.runId}. Mode: ${s.manifest.live ? 'real TypeSafe Jev' : 'offline; no model accuracy measured'}.`, '',
    `Local tests: **${s.tests.passed}/${s.tests.total} passed**.`,
    `Browser health fixtures: **${percent(s.health.matched)}** matched expected health statuses (${s.health.uniqueCases} distinct fixtures; repeats are not independent cases).`, '',
    '## Method', '',
    s.manifest.methodology, '',
    `${s.measuredRuns} measured runs over ${s.manifest.uniqueSemanticCases} unique prompt/change pairs, with ${s.manifest.repeats} repetition(s). ${s.manifest.warmupRequests} warmup API requests recorded separately. One browser/context/tab reused; 1280×720, en-US, UTC. Pages served through Playwright route interception, not a real Next.js/Vite app.`, '',
    'Each case has ONE predeclared primary question used for accuracy; all three returned answers are saved. These labels were authored by the coding agent and have not been independently human-reviewed. No thresholds or question wording were changed after seeing results.', '',
  ];
  if (s.accuracy) {
    lines.push('## Primary-question results (first repetition only)', '',
      '| Metric | All 30 cases | Evaluation families (20 cases) |', '|---|---:|---:|');
    for (const [key, label] of Object.entries({
      exactAgreement: 'Exact label agreement (including expected insufficient evidence)',
      falsePass: 'False passes / known violations',
      violationDetection: 'Detected violations / known violations',
      missedViolationIncludingAbstention: 'Missed violations (including abstention/unavailability)',
      falseFailure: 'False failures / valid changes',
      uncertain: 'Insufficient-evidence answers',
      unavailable: 'Unavailable/skipped',
      decisionCoverage: 'Definite decisions / all cases',
      selectiveAccuracy: 'Correct definite decisions / definite decisions',
      unsupportedCertainty: 'Definite answers / unobservable cases',
    })) lines.push(`| ${label} | ${percent(s.accuracy[key])} | ${percent(s.evaluationSplit[key])} |`);
    const interval = s.accuracy.falsePass.interval95;
    lines.push('', `False-pass proportion Wilson 95% interval: ${interval ? interval.map((n) => `${(n * 100).toFixed(1)}%`).join('–') : 'N/A'}. Small, related synthetic fixtures do not establish population reliability.`, '',
      `Repeated primary answers matching their first run: ${percent(s.repeatsMatchingFirstAnswer)}. Repeats measure stability, not additional independent accuracy samples.`, '',
      `Exploratory multiclass Brier score: ${s.accuracy.calibration.multiclassBrier?.toFixed(3) ?? 'N/A'} (0 is best; range 0–2). Five-bin ECE: ${s.accuracy.calibration.ece5?.toFixed(3) ?? 'N/A'}. These use answer probabilities, not the separate confidence field; too few cases for production calibration.`, '');
  }
  lines.push('## Latency', '', '| Stage | Samples | Median | p95 |', '|---|---:|---:|---:|');
  for (const [key, value] of Object.entries(s.latency)) lines.push(`| ${key} | ${value.count} | ${ms(value.medianMs)} | ${ms(value.p95Ms)} |`);
  lines.push('', `Browser launch: ${ms(s.browserStartupMs)}; first API request: ${ms(s.firstApiRequestMs ?? null)} (separate, one observation each). Combined timing includes AFTER navigation/readiness/capture, baseline read, diff, health checks, question preparation, and Jev. It excludes initial BEFORE capture, browser startup, compilation, output formatting, and human/agent editing time. Failures/timeouts remain in all-attempt latency. Percentiles use nearest rank; median averages the middle pair.`, '',
    '## Plain Playwright baseline', '',
    `Fixture-specific role/name/count assertions matched the declared satisfied/violated outcome on ${percent(s.assertions.matched)} structural cases. ${s.manifest.uniqueSemanticCases - s.assertions.firstRunCases} cases were outside this baseline's scope. Assertion-only median: ${ms(s.assertions.latency.medianMs)}; p95: ${ms(s.assertions.latency.p95Ms)} on already-loaded pages. These assertions encode each expected outcome by hand; this is not a zero-config semantic checker or an end-to-end timing comparison.`, '',
    '## API usage', '',
    `${s.evaluatedRuns}/${s.measuredRuns} measured runs received validated model answers. Reported input tokens including warmups: ${s.inputTokensIncludingWarmups}. Estimated input charge: $${s.estimatedInputCostUsd.toFixed(6)}. [Pricing source](https://docs.typesafe.ai/models), retrieved 2026-09-29; this is not a billing statement.`, '',
    '## Scope and artifacts', '',
    '- No Claude + Playwright MCP comparison was run; no claim of beating Claude.',
    '- No real-agent hook, autofix, real-app, visual, or backend verification benchmark.',
    '- Jev remains advisory. A CLI health pass is not a semantic pass.',
    '- `cases.json` freezes prompts, HTML, expected primary labels, and label rationales.',
    '- `runs.jsonl` retains every captured state, diff, prepared request, model response, and timing.',
    '- `health.jsonl`, `warmups.jsonl` (live only), `tests.tap`, `results.csv`, and `summary.json` retain supporting evidence.',
    '- Review labels and test independent real applications before presenting accuracy as general performance.', '',
  );
  return lines.join('\n');
}
