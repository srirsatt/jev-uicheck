import { performance } from 'node:perf_hooks';
import type { BrowserEvent } from '../browser/events.js';
import type { PageCaptureResult } from '../runner.js';

export type CheckStatus = 'pass' | 'fail' | 'uncertain';

export type CheckEvidence =
  | { source: 'browser-event'; index: number; event: BrowserEvent }
  | { source: 'capture'; detail: string }
  | { source: 'snapshot'; line: number; text: string };

export interface CheckResult {
  id: string;
  label: string;
  status: CheckStatus;
  message: string;
  evidence: CheckEvidence[];
}

export interface HealthReport {
  url: string;
  status: CheckStatus;
  checks: CheckResult[];
  durationMs: number;
}

const errorChecks: { kind: BrowserEvent['kind']; label: string }[] = [
  { kind: 'console-error', label: 'Console errors' },
  { kind: 'page-error', label: 'Uncaught JavaScript errors' },
  { kind: 'request-failed', label: 'Failed network requests' },
  { kind: 'http-error', label: 'HTTP error responses' },
];

/** Initial universal checks: capture coverage, accessible content, and browser errors.
 * A failure means an observed health problem, not proof that this edit caused it.
 */
export function evaluatePageHealth(capture: PageCaptureResult): HealthReport {
  const started = performance.now();
  const complete = capture.status === 'captured';
  const coverageMessage = complete
    ? 'Page reached its capture checkpoint.'
    : `Capture did not complete during ${capture.error.stage}: ${capture.error.message}`;
  const checks: CheckResult[] = [{
    id: 'capture-completed', label: 'Page capture',
    status: complete ? 'pass' : 'uncertain',
    message: coverageMessage,
    evidence: [{ source: 'capture', detail: coverageMessage }],
  }];

  // Nonempty ARIA is evidence of accessible content, not a complete/working UI.
  const lines = complete ? capture.state.ariaSnapshot.split('\n') : [];
  const firstContent = lines.findIndex((line) => line.trim().length > 0);
  const contentMessage = firstContent >= 0
    ? 'Accessibility snapshot contains content.'
    : complete ? 'Accessibility snapshot is empty; page content could not be verified.'
      : 'No completed snapshot is available.';
  checks.push({
    id: 'accessible-content', label: 'Accessible content',
    status: firstContent >= 0 ? 'pass' : 'uncertain',
    message: contentMessage,
    evidence: firstContent >= 0
      ? [{ source: 'snapshot', line: firstContent + 1, text: lines[firstContent]! }]
      : [{ source: 'capture', detail: contentMessage }],
  });

  for (const { kind, label } of errorChecks) {
    const evidence: CheckEvidence[] = [];
    capture.evidence.events.forEach((event, index) => {
      if (event.kind === kind) evidence.push({ source: 'browser-event', index: index + 1, event });
    });

    let status: CheckStatus;
    let message: string;
    if (evidence.length > 0) {
      status = 'fail';
      message = `${evidence.length} error event(s) observed.`;
    } else if (!complete || capture.evidence.droppedEvents > 0) {
      status = 'uncertain';
      message = 'Cannot confirm absence of errors: capture or event collection was incomplete.';
    } else {
      status = 'pass';
      message = 'No errors of this type observed during this capture.';
    }
    if (capture.evidence.droppedEvents > 0) {
      const detail = `${capture.evidence.droppedEvents} browser events were omitted after the collection limit.`;
      evidence.push({ source: 'capture', detail });
    }
    if (evidence.length === 0) evidence.push({ source: 'capture', detail: message });
    checks.push({ id: kind, label, status, message, evidence });
  }

  // Keep known failures even when other checks could not be completed.
  const status = checks.some((check) => check.status === 'fail') ? 'fail'
    : checks.some((check) => check.status === 'uncertain') ? 'uncertain' : 'pass';
  return {
    url: capture.requestedUrl,
    status,
    checks,
    durationMs: capture.timingsMs.total + performance.now() - started,
  };
}
