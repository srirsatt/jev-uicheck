#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { runHealthCheck } from './runner.js';
import { formatHealthReport, healthExitCode } from './report.js';

const help = `Usage: jev-uicheck-fast <url> --ready <selector> [--snapshot] [--json]

Claude Code setup (one route):
  jev-uicheck-fast init-claude --project <app-directory> --url <url> --ready <selector>
Codex setup (one route):
  jev-uicheck-fast init-codex --project <app-directory> --url <url> --ready <selector>

  --ready       Playwright selector for an expected visible element (required)
  --timeout     Navigation/readiness timeout per stage in milliseconds (default: 5000)
  --snapshot    Also print the captured ARIA snapshot
  --json        Print the complete capture and report as JSON
  --help        Show this help

Example:
  jev-uicheck-fast http://localhost:3000/login --ready 'h1' --snapshot

From the source checkout:
  npm run check -- http://localhost:3000/login --ready 'h1' --snapshot

Checks current page health in a fresh, logged-out browser context.
Exit codes: 0 = pass, 1 = observed failure, 2 = uncertain or tool/setup error.
`;

async function main(): Promise<void> {
  const command = process.argv[2];
  if (['init-claude', 'init-codex', 'hook', 'hook-codex'].includes(command ?? '')) {
    // Hook stdout must contain only protocol JSON, even if setup/browser work fails.
    if (command === 'hook' || command === 'hook-codex') {
      try {
        const { values } = parseArgs({ args: process.argv.slice(3), options: { project: { type: 'string' } } });
        if (!values.project) throw new Error('Missing project.');
        const { readHookStdin } = await import('./hooks/lifecycle.js');
        const handle = command === 'hook-codex'
          ? (await import('./hooks/codex.js')).handleCodexHook
          : (await import('./hooks/claude.js')).handleClaudeHook;
        console.log(JSON.stringify(await handle(resolve(values.project), await readHookStdin())));
      } catch {
        console.log(JSON.stringify({ systemMessage: 'Jev UI check unavailable: check uicheck.config.json, browser installation, and local state permissions. No automatic repair requested; this is not a pass.' }));
      }
      return;
    }
    const { values } = parseArgs({ args: process.argv.slice(3), options: {
      project: { type: 'string', default: process.cwd() }, url: { type: 'string' }, ready: { type: 'string' },
    } });
    if (!values.url || !values.ready) throw new Error(`${command} requires --url and --ready.`);
    const { installClaudeHooks, installCodexHooks } = await import('./hooks/config.js');
    const codex = command === 'init-codex';
    const installed = await (codex ? installCodexHooks : installClaudeHooks)(values.project!, values.url, values.ready, fileURLToPath(import.meta.url));
    console.log(`Installed ${codex ? 'Codex' : 'Claude Code'} hooks in ${installed.settingsPath}\nRoute config: ${installed.configPath}\nStart your dev server, then start a new ${codex ? 'Codex' : 'Claude Code'} session in that project.\nOptional: set TYPESAFE_API_KEY in that project's .env for advisory Jev checks.`);
    if (codex) console.log('In Codex, trust the project and use /hooks to review and trust the three Jev UI check hooks, then submit a new prompt. Codex skips untrusted hooks.');
    return;
  }
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
