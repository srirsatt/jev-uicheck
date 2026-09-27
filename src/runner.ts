import { performance } from 'node:perf_hooks';
import type { Locator, Page } from 'playwright';
import { capturePageState } from './browser/capture-state.js';
import type { PageState } from './browser/capture-state.js';
import { collectBrowserEvents } from './browser/events.js';
import type { BrowserEvidence } from './browser/events.js';

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
