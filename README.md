# Jev UI Check

Proposed automatic UI verification for local web development with Codex and Claude Code.

Planned distribution: an npm package with one-time setup through npx.

Early development: the page runner loads a URL, waits for an explicit visible element, and captures its accessibility snapshot, URL, title, console errors, uncaught exceptions, failed requests, and HTTP errors. It reports incomplete captures separately and records stage timings. Agent hooks and Jev evaluation are not implemented yet.

`runHealthCheck` captures a page and checks capture completion, nonempty accessible content, and the four browser error categories. Results are `pass`, `fail`, or `uncertain`, with evidence attached. Missing evidence and truncated event collection cannot produce a clean pass. `formatHealthReport` produces a terminal summary; `healthExitCode` maps the result to ordinary CLI codes (0 = pass, 1 = observed failure, 2 = uncertain without observed failure). These codes are not agent-hook responses. The initial policy flags every recorded error, including pre-existing or expected errors; it does not attribute them to the current edit or trigger repairs. Error-boundary detection, suspicious text, accessible-label checks, and interaction scenarios remain to be built. A health pass does not verify functionality or prompt intent.

`captureBefore` saves the original page state and prompt through a `BaselineStore`. `captureAfter` compares against it using a line diff with BEFORE/AFTER line references and URL/title changes. The store directory should be inside the target project's ignored `.jev-uicheck/` directory. Baselines are keyed by task, checkpoint, and requested URL; repair attempts keep the original baseline. Callers must keep the checkpoint's browser settings and auth setup consistent. A missing baseline or incomplete diff is reported explicitly. Changed blocks describe snapshot text changes, not proven element identity or regressions. Browser events are returned per capture; baseline files currently persist only the page state and prompt.

For local development, run `npm install`, then `npm run typecheck` or `npm run build`.

For your own running app, use `npm run check -- http://localhost:3000/login --ready 'h1' --snapshot`. Choose a selector that identifies a visible element at the point you want to capture; the checker does not wait for later activity after capture finishes. The browser starts with a fresh context, without your existing login session. Add `--timeout 10000` for slower pages. No agent hooks or interaction scenarios run yet.

For full JSON evidence, run `npm run build` followed by `node dist/cli.js <url> --ready '<selector>' --json`. Calling the compiled CLI directly avoids npm's build messages in JSON output. Reported timings cover capture and evaluation, excluding compilation and browser startup.

Run `npx playwright install chromium --only-shell` once to install the test browser, then `npm test` for the diff, persistence, and browser integration tests. No Jev API key is needed yet.

Jev UI Check is an unofficial community project and is not affiliated with or endorsed by TypeSafe.
