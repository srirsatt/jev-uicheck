# jev-uicheck-fast — controlled fixture benchmark

Run: 2026-09-30T00-34-12-325Z. Mode: real TypeSafe Jev.

Local tests: **35/35 passed**.
Browser health fixtures: **24/24 (100.0%)** matched expected health statuses (8 distinct fixtures; repeats are not independent cases).

## Method

Synthetic fixtures captured by real Chromium. Agent-authored primary labels frozen before inference. No question/threshold tuning in this run. Accuracy uses the first repetition only. Other answers are retained but not assigned accuracy labels. Evaluation families share templates with development; not an independent real-app holdout.

90 measured runs over 30 unique prompt/change pairs, with 3 repetition(s). 3 warmup API requests recorded separately. One browser/context/tab reused; 1280×720, en-US, UTC. Pages served through Playwright route interception, not a real Next.js/Vite app.

Each case has ONE predeclared primary question used for accuracy; all three returned answers are saved. These labels were authored by the coding agent and have not been independently human-reviewed. No thresholds or question wording were changed after seeing results.

## Primary-question results (first repetition only)

| Metric | All 30 cases | Evaluation families (20 cases) |
|---|---:|---:|
| Exact label agreement (including expected insufficient evidence) | 24/30 (80.0%) | 15/20 (75.0%) |
| False passes / known violations | 0/12 (0.0%) | 0/8 (0.0%) |
| Detected violations / known violations | 12/12 (100.0%) | 8/8 (100.0%) |
| Missed violations (including abstention/unavailability) | 0/12 (0.0%) | 0/8 (0.0%) |
| False failures / valid changes | 0/9 (0.0%) | 0/6 (0.0%) |
| Insufficient-evidence answers | 13/30 (43.3%) | 9/20 (45.0%) |
| Unavailable/skipped | 0/30 (0.0%) | 0/20 (0.0%) |
| Definite decisions / all cases | 17/30 (56.7%) | 11/20 (55.0%) |
| Correct definite decisions / definite decisions | 16/17 (94.1%) | 10/11 (90.9%) |
| Definite answers / unobservable cases | 1/9 (11.1%) | 1/6 (16.7%) |

False-pass proportion Wilson 95% interval: 0.0%–24.2%. Small, related synthetic fixtures do not establish population reliability.

Repeated primary answers matching their first run: 55/60 (91.7%). Repeats measure stability, not additional independent accuracy samples.

Exploratory multiclass Brier score: 0.217 (0 is best; range 0–2). Five-bin ECE: 0.081. These use answer probabilities, not the separate confidence field; too few cases for production calibration.

## Latency

| Stage | Samples | Median | p95 |
|---|---:|---:|---:|
| combinedAllAttempts | 90 | 192.3 ms | 273.1 ms |
| combinedSuccessfulApi | 90 | 192.3 ms | 273.1 ms |
| jevAllAttempts | 90 | 156.4 ms | 237.4 ms |
| navigation | 90 | 14.2 ms | 18.9 ms |
| readiness | 90 | 15.4 ms | 18.8 ms |
| snapshot | 90 | 4.0 ms | 5.6 ms |
| diff | 90 | 0.0 ms | 0.1 ms |
| formatting | 90 | 0.1 ms | 0.1 ms |
| beforeCaptureAndSave | 30 | 15.4 ms | 22.1 ms |

Browser launch: 91.7 ms; first API request: 579.6 ms (separate, one observation each). Combined timing includes AFTER navigation/readiness/capture, baseline read, diff, health checks, question preparation, and Jev. It excludes initial BEFORE capture, browser startup, compilation, output formatting, and human/agent editing time. Failures/timeouts remain in all-attempt latency. Percentiles use nearest rank; median averages the middle pair.

## Plain Playwright baseline

Fixture-specific role/name/count assertions matched the declared satisfied/violated outcome on 21/21 (100.0%) structural cases. 9 cases were outside this baseline's scope. Assertion-only median: 5.0 ms; p95: 8.1 ms on already-loaded pages. These assertions encode each expected outcome by hand; this is not a zero-config semantic checker or an end-to-end timing comparison.

## API usage

90/90 measured runs received validated model answers. Reported input tokens including warmups: 117426. Estimated input charge: $0.004932. [Pricing source](https://docs.typesafe.ai/models), retrieved 2026-09-29; this is not a billing statement.

## Scope and artifacts

- No Claude + Playwright MCP comparison was run; no claim of beating Claude.
- No real-agent hook, autofix, real-app, visual, or backend verification benchmark.
- Jev remains advisory. A CLI health pass is not a semantic pass.
- `cases.json` freezes prompts, HTML, expected primary labels, and label rationales.
- `runs.jsonl` retains every captured state, diff, prepared request, model response, and timing.
- `health.jsonl`, `warmups.jsonl` (live only), `tests.tap`, `results.csv`, and `summary.json` retain supporting evidence.
- Review labels and test independent real applications before presenting accuracy as general performance.

## Reproduction artifacts

Local raw artifact directory: `benchmarks/results/2026-09-30T00-34-12-325Z`. Raw outputs are ignored by Git; publish them separately if you want readers to audit the numbers. The cases and benchmark runner are versioned.

## Cases to review

Primary judgments that differed from the predeclared agent-authored expectations. No questions or labels were changed after the run.

| Case | Expected | Jev | Confidence |
|---|---|---|---:|
| shop/rename-correct | satisfied | insufficient_evidence | 0.35 |
| shop/add-correct | satisfied | insufficient_evidence | 0.45 |
| settings/rename-correct | satisfied | insufficient_evidence | 0.29 |
| shop/visual-only | insufficient_evidence | violated | 0.32 |
| login/add-correct | satisfied | insufficient_evidence | 0.51 |
| settings/add-correct | satisfied | insufficient_evidence | 0.54 |

Repeats also produced unsupported visual judgments for login/settings and changed the correct login rename from satisfied to insufficient evidence. Keep the semantic layer advisory; this dataset does not justify automatic model-driven fixes.
