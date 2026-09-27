# Jev UI Check

Proposed automatic UI verification for local web development with Codex and Claude Code.

Planned distribution: an npm package with one-time setup through npx.

Early development: the page runner loads a URL, waits for an explicit visible element, and captures its accessibility snapshot, URL, title, console errors, uncaught exceptions, failed requests, and HTTP errors. It reports incomplete captures separately and records stage timings. Automatic checks, agent hooks, and Jev evaluation are not implemented yet.

For local development, run `npm install`, then `npm run typecheck` or `npm run build`.

Run `npx playwright install chromium --only-shell` once to install the test browser, then `npm test` for the browser integration test.

Jev UI Check is an unofficial community project and is not affiliated with or endorsed by TypeSafe.
