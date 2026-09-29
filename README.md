# Jev UI Check

Proposed automatic UI verification for local web development with Codex and Claude Code.

Planned distribution: an npm package with one-time setup through npx.

Early development: the page runner loads a URL, waits for an explicit visible element, and captures its accessibility snapshot, URL, title, console errors, uncaught exceptions, failed requests, and HTTP errors. It reports incomplete captures separately and records stage timings. Automatic checks, agent hooks, and Jev evaluation are not implemented yet.

`captureBefore` saves the original page state and prompt through a `BaselineStore`. `captureAfter` compares against it using a line diff with BEFORE/AFTER line references and URL/title changes. The store directory should be inside the target project's ignored `.jev-uicheck/` directory. Baselines are keyed by task, checkpoint, and requested URL; repair attempts keep the original baseline. Callers must keep the checkpoint's browser settings and auth setup consistent. A missing baseline or incomplete diff is reported explicitly. Changed blocks describe snapshot text changes, not proven element identity or regressions. Browser events are returned per capture; baseline files currently persist only the page state and prompt.

For local development, run `npm install`, then `npm run typecheck` or `npm run build`.

Run `npx playwright install chromium --only-shell` once to install the test browser, then `npm test` for the diff, persistence, and browser integration tests. No Jev API key is needed yet.

Jev UI Check is an unofficial community project and is not affiliated with or endorsed by TypeSafe.
