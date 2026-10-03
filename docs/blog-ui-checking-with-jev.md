# UI Checks with Jev and Playwright

Oct 3, 2026

I’ve been experimenting with Jev by TypeSafe AI for checking UI changes. The idea: when a coding agent finishes an edit, compare what actually changed in the browser with what I asked for.

For example, imagine asking for a “Remember me” checkbox and getting the checkbox, but losing the login button along the way. The page could still load without errors. I wanted a check that could flag that kind of change.

I built `jev-uicheck-fast` around Playwright and TypeScript. Playwright captures the page’s accessibility tree before and after an edit: the headings, buttons, labels, and other accessible content. TypeScript computes a diff, then sends it with the original prompt to Jev.

One request asks three questions: did the edit satisfy the request, did anything unrelated change, and did it remove or break an existing capability? Each answer is `satisfied`, `violated`, or `insufficient_evidence`, with probabilities. Console errors, failed requests, and other browser errors get checked locally too.

The initial benchmark used 30 synthetic prompt/change pairs across login, shopping, and settings pages, repeated three times with real Jev calls. Label agreement uses only the first run of each case, with one question scored per case.

| Metric | Result |
| --- | ---: |
| Combined check, median / p95 | 192 / 273 ms |
| Jev request, median | 156 ms |
| Agreement with predefined labels | 24/30 (80%) |
| Seeded violations detected | 12/12 |
| Insufficient-evidence answers | 13/30 |

The timing uses a warm browser and includes the after-capture, diff, browser health checks, and Jev. Browser startup and the initial before-capture are excluded. The fixtures share templates, and a coding agent wrote the expected labels, so this is an early experiment with a small synthetic dataset.

The interesting part for me was the uncertainty. Jev sometimes abstained on correct changes, and it made one unsupported judgment about a visual change. Accessibility text can show that a button exists; testing what happens when you click it requires more evidence. Colors and layout need screenshots too.

So Jev’s judgments stay advisory. The project also has Claude Code and Codex hook adapters that capture before a task and check when the agent tries to finish. Confirmed browser errors can request up to three repairs. Those adapters have browser integration tests; live agent sessions still need validation.

I’d like to add click-and-check scenarios next, then try a wider set of real apps. Lowk, getting useful feedback on an agent’s UI edits with this little overhead feels promising 😸.

[Code](https://github.com/srirsatt/jev-uicheck) · [Benchmark details](https://github.com/srirsatt/jev-uicheck/blob/main/benchmarks/RESULTS.md)
