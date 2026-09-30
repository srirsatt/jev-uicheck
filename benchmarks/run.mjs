import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { arch, cpus, platform } from 'node:os';
import { join } from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { performance } from 'node:perf_hooks';
import { chromium } from 'playwright';
import { captureBefore, runCombinedCheck, runHealthCheck } from '../dist/runner.js';
import { BaselineStore } from '../dist/store.js';
import { formatCombinedReport } from '../dist/report.js';
import { semanticCases, healthCases } from './cases.mjs';
import { judgments, latency, rate } from './metrics.mjs';
import { renderSummary } from './summary.mjs';

const { values } = parseArgs({ options: { live: { type: 'boolean', default: false }, repeats: { type: 'string', default: '3' } } });
const repeats = Number(values.repeats);
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10) throw new Error('--repeats must be 1–10.');
const live = values.live;
if (live) {
  try { loadEnvFile(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!process.env.TYPESAFE_API_KEY?.trim()) throw new Error('Set TYPESAFE_API_KEY before using --live.');
}
const root = fileURLToPath(new URL('../', import.meta.url));
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const output = join(root, 'benchmarks/results', runId);
await mkdir(output, { recursive: true });
console.log(`Artifacts: benchmarks/results/${runId}`);

const hash = (value) => createHash('sha256').update(value).digest('hex');
const fixtureJson = JSON.stringify({ semanticCases, healthCases }, null, 2);
const manifest = {
  runId, live, repeats, uniqueSemanticCases: semanticCases.length, healthCases: healthCases.length,
  warmupRequests: live ? 3 : 0, plannedMeasuredRequests: live ? repeats * semanticCases.length : 0,
  fixtureSha256: hash(fixtureJson),
  questionsSha256: hash(await readFile(join(root, 'src/checks/questions.ts'), 'utf8')),
  gitCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  workingTreeDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()),
  environment: { node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model,
    playwright: JSON.parse(await readFile(join(root, 'node_modules/playwright/package.json'), 'utf8')).version },
  viewport: { width: 1280, height: 720 },
  methodology: 'Synthetic fixtures captured by real Chromium. Agent-authored primary labels frozen before inference. No question/threshold tuning in this run. Accuracy uses the first repetition only. Other answers are retained but not assigned accuracy labels. Evaluation families share templates with development; not an independent real-app holdout.',
};
await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
await writeFile(join(output, 'cases.json'), fixtureJson);

console.log('Running all local tests (mocked Jev; real Chromium integration)...');
const testFiles = (await readdir(join(root, 'test'))).filter((file) => file.endsWith('.test.mjs')).sort();
let testRun;
try {
  testRun = await promisify(execFile)(process.execPath, ['--test', '--test-reporter=tap', ...testFiles.map((file) => `test/${file}`)], { cwd: root, maxBuffer: 5_000_000 });
} catch (error) {
  await writeFile(join(output, 'tests.tap'), `${error.stdout ?? ''}\n${error.stderr ?? ''}`);
  throw new Error('Local tests failed; see tests.tap. No model benchmark was started.');
}
await writeFile(join(output, 'tests.tap'), testRun.stdout);
const tapNumber = (name) => Number(testRun.stdout.match(new RegExp(`^# ${name} ([0-9.]+)$`, 'm'))?.[1] ?? NaN);
const tests = { total: tapNumber('tests'), passed: tapNumber('pass'), failed: tapNumber('fail'), durationMs: tapNumber('duration_ms') };
if (!Number.isFinite(tests.total) || tests.failed !== 0) throw new Error('Could not establish passing test counts.');
console.log(`Tests: ${tests.passed}/${tests.total} passed.`);

let browser;
const rows = [];
const healthRows = [];
const warmups = [];
const store = new BaselineStore(join(output, 'baselines'));
const browserStarted = performance.now();
try {
  browser = await chromium.launch();
  const browserStartupMs = performance.now() - browserStarted;
  const context = await browser.newContext({ viewport: manifest.viewport, locale: 'en-US', timezoneId: 'UTC', serviceWorkers: 'block' });
  const page = await context.newPage();
  let html = '';
  await page.route('http://benchmark.test/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/offline') return route.abort('connectionrefused');
    if (pathname === '/api/404' || pathname === '/api/500') return route.fulfill({ status: Number(pathname.slice(-3)), body: 'Deliberate fixture failure' });
    return route.fulfill({ contentType: 'text/html', body: html });
  });
  const options = { ready: page.locator('body[data-ready="true"]'), timeoutMs: 1500 };
  const keys = new Map();
  const beforeTimes = [];
  for (const fixture of semanticCases) {
    html = fixture.beforeHtml;
    const key = { taskId: fixture.id, checkpointId: `${fixture.app}/initial`, url: `http://benchmark.test/${fixture.app}` };
    keys.set(fixture.id, key);
    const started = performance.now();
    const before = await captureBefore(page, store, key, fixture.prompt, options);
    assert.equal(before.status, 'saved', `BEFORE capture failed: ${fixture.id}`);
    beforeTimes.push(performance.now() - started);
  }

  const jevOptions = live ? {} : { apiKey: '' }; // Offline means no API calls at all.
  if (live) {
    console.log(`Making 3 recorded warmup requests, then ${repeats * semanticCases.length} measured requests.`);
    for (let i = 0; i < 3; i++) {
      const fixture = semanticCases[0];
      html = fixture.afterHtml;
      const result = await runCombinedCheck(page, store, keys.get(fixture.id), options, jevOptions);
      warmups.push(result);
      await appendFile(join(output, 'warmups.jsonl'), JSON.stringify(result) + '\n');
      if (result.report.jev.status === 'unavailable' && [401, 403].includes(result.report.jev.httpStatus)) {
        throw new Error('TypeSafe rejected authentication. Stopping before measured requests.');
      }
    }
  }

  // Seeded shuffle avoids timing every family in the same order on every repeat.
  let seed = 42;
  const shuffle = (items) => {
    const list = [...items];
    for (let i = list.length - 1; i > 0; i--) {
      seed = (1664525 * seed + 1013904223) >>> 0;
      const j = seed % (i + 1);
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  };
  for (let repetition = 0; repetition < repeats; repetition++) {
    for (const fixture of shuffle(semanticCases)) {
      html = fixture.afterHtml;
      const result = await runCombinedCheck(page, store, keys.get(fixture.id), options, jevOptions);
      const started = performance.now();
      const textReport = formatCombinedReport(result.report);
      const formatMs = performance.now() - started;
      const assertionStarted = performance.now();
      let assertion = { status: 'unsupported', durationMs: null };
      if (fixture.assertions && result.comparison.capture.status === 'captured') {
        const observations = [];
        for (const rule of fixture.assertions) {
          const actual = await page.getByRole(rule.role, { name: rule.name, exact: true }).count();
          observations.push({ ...rule, actual });
        }
        assertion = { status: observations.every((r) => r.actual === r.count) ? 'satisfied' : 'violated',
          durationMs: performance.now() - assertionStarted, observations };
        assert.equal(assertion.status, fixture.expected, `Fixture/assertion mismatch: ${fixture.id}`);
      }
      const jev = result.report.jev;
      const answer = jev.status === 'evaluated' ? jev.response.answers[fixture.primary] : undefined;
      const row = {
        id: fixture.id, app: fixture.app, split: fixture.split, repetition,
        primary: fixture.primary, expected: fixture.expected, actual: answer?.choice ?? jev.status,
        probabilities: answer?.probabilities, confidence: answer?.confidence,
        assertion, formatMs, ...result,
      };
      rows.push(row);
      await appendFile(join(output, 'runs.jsonl'), JSON.stringify(row) + '\n');
      if (repetition === 0) await writeFile(join(output, `${fixture.id.replace('/', '-')}.txt`), textReport);
      if (rows.length % 10 === 0) console.log(`Measured ${rows.length}/${repeats * semanticCases.length} runs; latest: ${fixture.id} → ${row.actual}`);
    }
  }

  for (let repetition = 0; repetition < repeats; repetition++) {
    for (const fixture of healthCases) {
      html = fixture.html;
      const result = await runHealthCheck(page, { ...options, url: `http://benchmark.test/health/${fixture.id}`, timeoutMs: 250 });
      const row = { id: fixture.id, repetition, expected: fixture.expected, actual: result.report.status, ...result };
      healthRows.push(row);
      await appendFile(join(output, 'health.jsonl'), JSON.stringify(row) + '\n');
    }
  }

  const primary = rows.filter((r) => r.repetition === 0);
  const evaluated = rows.filter((r) => r.report.jev.status === 'evaluated');
  const tokens = [...rows, ...warmups].reduce((sum, r) => sum + (r.report.jev.status === 'evaluated' ? r.report.jev.response.usage.input_tokens : 0), 0);
  const timing = (select) => latency(rows.map(select));
  const summary = {
    manifest, tests, browserStartupMs,
    firstApiRequestMs: warmups[0]?.report.jev.durationMs ?? null,
    measuredRuns: rows.length, evaluatedRuns: evaluated.length,
    inputTokensIncludingWarmups: tokens,
    estimatedInputCostUsd: tokens * 0.042 / 1_000_000,
    costSource: 'https://docs.typesafe.ai/models (2026-09-29: $0.042/M input tokens; estimate, not billing statement)',
    accuracy: live ? judgments(primary) : null,
    evaluationSplit: live ? judgments(primary.filter((r) => r.split === 'evaluation')) : null,
    perQuestion: live ? Object.fromEntries(['intent', 'unexpectedChanges', 'regression'].map((id) => [id, judgments(primary.filter((r) => r.primary === id))])) : null,
    repeatsMatchingFirstAnswer: rate(rows.filter((r) => r.repetition > 0 && r.actual === primary.find((p) => p.id === r.id).actual).length, rows.filter((r) => r.repetition > 0).length),
    health: { uniqueCases: healthCases.length, observations: healthRows.length, matched: rate(healthRows.filter((r) => r.actual === r.expected).length, healthRows.length) },
    assertions: {
      firstRunCases: primary.filter((r) => r.assertion.status !== 'unsupported').length,
      matched: rate(primary.filter((r) => r.assertion.status === r.expected).length, primary.filter((r) => r.assertion.status !== 'unsupported').length),
      latency: latency(rows.flatMap((r) => r.assertion.durationMs === null ? [] : [r.assertion.durationMs])),
    },
    latency: {
      combinedAllAttempts: timing((r) => r.report.timingsMs.total),
      combinedSuccessfulApi: latency(evaluated.map((r) => r.report.timingsMs.total)),
      jevAllAttempts: timing((r) => r.report.jev.durationMs),
      navigation: timing((r) => r.comparison.capture.timingsMs.navigation),
      readiness: timing((r) => r.comparison.capture.timingsMs.readiness),
      snapshot: timing((r) => r.comparison.capture.timingsMs.snapshot),
      diff: timing((r) => r.report.timingsMs.diff),
      formatting: timing((r) => r.formatMs),
      beforeCaptureAndSave: latency(beforeTimes),
    },
    errors: rows.filter((r) => r.report.jev.status !== 'evaluated').map((r) => ({ id: r.id, repetition: r.repetition, result: r.report.jev })),
  };
  await writeFile(join(output, 'summary.json'), JSON.stringify(summary, null, 2));
  await writeFile(join(output, 'summary.md'), renderSummary(summary));
  const columns = ['id', 'split', 'repetition', 'primary', 'expected', 'actual', 'confidence', 'totalMs', 'jevMs', 'assertion'];
  const csv = (cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`;
  await writeFile(join(output, 'results.csv'), [columns, ...rows.map((r) => [r.id, r.split, r.repetition, r.primary, r.expected, r.actual, r.confidence,
    r.report.timingsMs.total, r.report.jev.durationMs, r.assertion.status])].map((row) => row.map(csv).join(',')).join('\n'));
  console.log(renderSummary(summary));
} finally {
  await browser?.close();
}
