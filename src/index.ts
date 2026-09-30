// Public library entry point. Importing it does not launch a browser or call Jev.
export { capturePageState } from './browser/capture-state.js';
export type { PageState } from './browser/capture-state.js';
export { collectBrowserEvents } from './browser/events.js';
export type { BrowserEvent, BrowserEvidence } from './browser/events.js';
export { BaselineStore } from './store.js';
export type { Baseline, BaselineKey } from './store.js';
export { diffPageStates } from './checks/diff.js';
export type { StateDiff, SnapshotChange, SnapshotLine } from './checks/diff.js';
export { evaluatePageHealth } from './checks/universal.js';
export type { CheckStatus, CheckEvidence, CheckResult, HealthReport } from './checks/universal.js';
export { buildIntentRequest } from './checks/questions.js';
export type { IntentCheckId, IntentAnswer, IntentQuestion, IntentRequest, IntentPreparation } from './checks/questions.js';
export { evaluateIntent } from './jev.js';
export type { JevOptions, JevResult, JevAnswer } from './jev.js';
export { runPageCapture, runHealthCheck, captureBefore, captureAfter, runCombinedCheck } from './runner.js';
export type { CaptureOptions, PageCaptureResult } from './runner.js';
export { formatHealthReport, healthExitCode, formatCombinedReport, combinedExitCode } from './report.js';
export type { CombinedReport } from './report.js';
