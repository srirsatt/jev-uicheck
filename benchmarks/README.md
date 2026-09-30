# Controlled fixture benchmark

Run the complete local test suite with `npm test`.

Validate the fixtures and measurement code without contacting Jev:

```sh
npm run bench -- --repeats 1
```

Run the actual model benchmark using `TYPESAFE_API_KEY` in your environment or ignored `.env`:

```sh
npm run bench -- --live --repeats 3
```

The live command makes 93 requests: 3 recorded warmups and 30 cases × 3 measured repeats. Each request batches the existing three questions. Each run first executes the complete local test suite, and stops if those tests fail. No coding agent is invoked and no external app is modified. The fixture pages exist only inside Playwright; there is no demo web server.

Timestamped results go into ignored `benchmarks/results/` directories. Start with `summary.md`; use `results.csv` for analysis and `runs.jsonl` for the original captures, diffs, requests, responses, and timings. `manifest.json` records fixture/question hashes, code revision, environment, and run settings. Input data is synthetic; the API key is never included in artifacts.

The fixed 30 cases cover three page families. Login is the development family; shop/settings are the evaluation families. Because families reuse templates, this is not an independent real-world holdout. One primary question per case has an expectation and rationale, written before inference. Those expectations are coding-agent-authored and need independent human review before presenting agreement as validated accuracy. The remaining two responses per case are saved but are not given accuracy labels. No prompt or confidence threshold is tuned during the run.

Accuracy uses one observation per unique case (the first repetition), not all correlated repetitions. False pass means `satisfied` on an expected `violated` case. False failure means `violated` on an expected `satisfied` case. Uncertainty and unavailable responses remain in denominators. Violation recall and missed violations including abstention are reported alongside false passes, so always abstaining cannot look like a good detector. Decision coverage counts only satisfied/violated answers. Calibration is exploratory: a three-class Brier score and five-bin expected calibration error on the selected-answer probabilities, not Jev's separate confidence statistic.

Latency uses all measured attempts, including provider failures and timeouts. Initial browser startup and BEFORE capture are reported separately. The main combined number measures AFTER navigation, readiness, snapshot, baseline read, diff/preparation, health checks, and API evaluation in a reused browser. It is not an already-loaded-page-only benchmark or a full agent-turn benchmark.

The plain Playwright baseline uses explicit role/name/count assertions written for 21 structural cases. It does not receive the natural-language prompt or infer the expected UI. Its timing is assertion-only on the already-loaded page, so do not advertise a speedup ratio against combined timings. The nine visual/behavior/backend cases are intentionally outside this baseline's scope. The suite checks that these assertions agree with the predeclared structural labels before accepting results.

No Claude + Playwright MCP, hook/autofix, screenshots, authenticated application, or database evaluation is included. Keep Jev advisory until a larger independent benchmark supports changing that policy.
