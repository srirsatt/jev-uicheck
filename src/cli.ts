import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { runHealthCheck } from './runner.js';
import { formatHealthReport, healthExitCode } from './report.js';

const help = `Usage: npm run check -- <url> --ready <selector> [--snapshot] [--json]

  --ready       Playwright selector for an expected visible element (required)
  --timeout     Navigation/readiness timeout per stage in milliseconds (default: 5000)
  --snapshot    Also print the captured ARIA snapshot
  --json        Print the complete capture and report as JSON
  --help        Show this help

Example:
  npm run check -- http://localhost:3000/login --ready 'h1' --snapshot

Checks current page health in a fresh, logged-out browser context.
Exit codes: 0 = pass, 1 = observed failure, 2 = uncertain or tool/setup error.
`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      ready: { type: 'string' },
      timeout: { type: 'string', default: '5000' },
      snapshot: { type: 'boolean' },
      json: { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log(help);
    return;
  }
  if (positionals.length !== 1 || !values.ready?.trim()) {
    throw new Error(`Provide a URL and --ready selector.\n\n${help}`);
  }
  const url = new URL(positionals[0]!);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Use an http:// or https:// URL.');
  const timeoutMs = Number(values.timeout);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('--timeout must be a positive number.');

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const result = await runHealthCheck(page, {
      url: url.href,
      ready: page.locator(values.ready),
      timeoutMs,
    });
    if (values.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatHealthReport(result.report));
      if (values.snapshot && result.capture.status === 'captured') {
        console.log('\nARIA snapshot:\n' + result.capture.state.ariaSnapshot);
      }
    }
    process.exitCode = healthExitCode(result.report);
  } finally {
    await browser.close();
  }
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});
