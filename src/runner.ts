import { performance } from 'node:perf_hooks';
import type { Locator, Page } from 'playwright';
import { capturePageState } from './browser/capture-state.js';
import type { PageState } from './browser/capture-state.js';
import { collectBrowserEvents } from './browser/events.js';
import type { BrowserEvidence } from './browser/events.js';
import { diffPageStates } from './checks/diff.js';
import { BaselineStore } from './store.js';
import type { BaselineKey } from './store.js';
import { evaluatePageHealth } from './checks/universal.js';
import { buildIntentRequest } from './checks/questions.js';
import { evaluateIntent } from './jev.js';
import type { JevOptions } from './jev.js';
import type { CombinedReport } from './report.js';

type CaptureStage = 'navigation' | 'readiness' | 'snapshot';
type CaptureTimings = Record<CaptureStage | 'total', number>;

export interface CaptureOptions {
  url: string;
  // An expected element on this page, e.g. page.getByRole('heading', { name: 'Login' }).
  // Visibility is a checkpoint, not proof of hydration or functional correctness.
  ready: Locator;
  timeoutMs?: number;
}

export type PageCaptureResult = {
  requestedUrl: string;
  evidence: BrowserEvidence;
  timingsMs: CaptureTimings;
} & (
  | { status: 'captured'; state: PageState }
  | { status: 'incomplete'; error: { stage: CaptureStage; message: string } }
);

/** First part of the runner: gather evidence using an already-open browser tab. */
export async function runPageCapture(
  page: Page,
  options: CaptureOptions,
): Promise<PageCaptureResult> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('timeoutMs must be a positive, finite number.');
  }
  if (options.ready.page() !== page) {
    throw new Error('The readiness locator must belong to the page being captured.');
  }

  const started = performance.now();
  const timingsMs: CaptureTimings = { navigation: 0, readiness: 0, snapshot: 0, total: 0 };
  const collector = collectBrowserEvents(page);
  let stage: CaptureStage = 'navigation';
  let stageStarted = performance.now();
  let outcome:
    | { status: 'captured'; state: PageState }
    | { status: 'incomplete'; error: { stage: CaptureStage; message: string } };
  let evidence: BrowserEvidence;

  try {
    await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    timingsMs.navigation = performance.now() - stageStarted;

    stage = 'readiness';
    stageStarted = performance.now();
    await options.ready.waitFor({ state: 'visible', timeout: timeoutMs });
    timingsMs.readiness = performance.now() - stageStarted;

    stage = 'snapshot';
    stageStarted = performance.now();
    const state = await capturePageState(page);
    timingsMs.snapshot = performance.now() - stageStarted;
    outcome = { status: 'captured', state };
  } catch (error) {
    timingsMs[stage] = performance.now() - stageStarted;
    outcome = {
      status: 'incomplete',
      error: { stage, message: error instanceof Error ? error.message : String(error) },
    };
  } finally {
    // Runs on success and failure so repeated captures cannot accumulate listeners.
    evidence = collector.stop();
    timingsMs.total = performance.now() - started;
  }

  return { requestedUrl: options.url, ...outcome, evidence, timingsMs };
}

/** Capture a page and evaluate its current health; no Jev call or baseline required. */
export async function runHealthCheck(page: Page, options: CaptureOptions) {
  const capture = await runPageCapture(page, options);
  return { capture, report: evaluatePageHealth(capture) };
}

// adds captureBefore() and captureAfter() to check before and after ARIA states 
// Call before edits. Repeated calls for the same task never replace its baseline.
export async function captureBefore(
  page: Page,
  store: BaselineStore,
  key: BaselineKey,
  prompt: string,
  options: Omit<CaptureOptions, 'url'>,
) {
  const existing = await store.load(key);
  if (existing) {
    if (existing.prompt !== prompt) throw new Error('A new user prompt needs a new task ID.');
    return { status: 'existing' as const, baseline: existing };
  }
  const capture = await runPageCapture(page, { ...options, url: key.url });
  if (capture.status === 'incomplete') return { status: 'incomplete' as const, capture };
  const status = await store.save(key, prompt, capture.state);
  const baseline = await store.load(key);
  if (!baseline || baseline.prompt !== prompt) throw new Error('Baseline changed unexpectedly while saving.');
  return { status, baseline, capture };
}

// Call after edits and again after repairs. All attempts use the original BEFORE.
export async function captureAfter(
  page: Page,
  store: BaselineStore,
  key: BaselineKey,
  options: Omit<CaptureOptions, 'url'>,
) {
  const baseline = await store.load(key);
  const capture = await runPageCapture(page, { ...options, url: key.url });
  if (capture.status === 'incomplete') return {
    status: 'incomplete' as const, capture, intent: buildIntentRequest(baseline, undefined),
  };
  // Keep AFTER evidence for universal checks even if this route was discovered late.
  if (!baseline) return {
    status: 'no-baseline' as const, capture, intent: buildIntentRequest(undefined, undefined),
  };
  const started = performance.now();
  const diff = diffPageStates(baseline.state, capture.state);
  return {
    status: diff.status === 'complete' ? 'compared' as const : 'incomplete' as const,
    baseline,
    capture,
    diff,
    diffMs: performance.now() - started,
    intent: buildIntentRequest(baseline, diff),
  };
}

/** Explicit combined run: one AFTER capture, health checks, and one batched Jev call.
 * Missing/incomplete comparison evidence skips Jev without a network request.
 */

// get after, check wit before
export async function runCombinedCheck(
  page: Page,
  store: BaselineStore,
  key: BaselineKey,
  options: Omit<CaptureOptions, 'url'>,
  jevOptions: JevOptions = {},
) {
  const started = performance.now();
  const comparison = await captureAfter(page, store, key, options);
  const health = evaluatePageHealth(comparison.capture);
  const jev = await evaluateIntent(comparison.intent, jevOptions);
  const report: CombinedReport = {
    health,
    jev,
    timingsMs: {
      total: performance.now() - started,
      diff: comparison.diffMs ?? 0,
      jev: jev.durationMs,
    },
  };
  return { comparison, report };
}
