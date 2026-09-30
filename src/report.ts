import type { CheckEvidence, CheckStatus, HealthReport } from './checks/universal.js';
import type { IntentCheckId } from './checks/questions.js';
import type { JevResult } from './jev.js';

export interface CombinedReport {
  health: HealthReport;
  jev: JevResult;
  timingsMs: { total: number; diff: number; jev: number };
}

const symbols: Record<CheckStatus, string> = { pass: '✓', fail: '✗', uncertain: '?' };

// Browser messages are untrusted text: keep control characters out of terminal output.
function oneLine(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');
}

function formatEvidence(evidence: CheckEvidence): string {
  if (evidence.source === 'capture') return evidence.detail;
  if (evidence.source === 'snapshot') return `snapshot:${evidence.line} ${evidence.text}`;
  const { event, index } = evidence;
  const prefix = `event:${index}`;
  switch (event.kind) {
    case 'console-error':
      return `${prefix} ${event.message}${event.url ? ` (${event.url}:${event.line + 1})` : ''}`;
    case 'page-error':
      return `${prefix} ${event.message}`;
    case 'request-failed':
      return `${prefix} ${event.method} ${event.url}: ${event.reason}`;
    case 'http-error':
      return `${prefix} ${event.method} ${event.url} → ${event.status}`;
  }
}

/** Text is a compact view; the structured report keeps every evidence entry. */
export function formatHealthReport(report: HealthReport): string {
  const count = (status: CheckStatus) => report.checks.filter((check) => check.status === status).length;
  const summary = `${count('pass')} passed, ${count('fail')} failed, ${count('uncertain')} uncertain`;
  const lines = [
    `${symbols[report.status]} UI health — ${summary} (${(report.durationMs / 1_000).toFixed(2)}s)`,
    `  ${oneLine(report.url)}`,
  ];
  for (const check of report.checks) {
    lines.push(`  ${symbols[check.status]} ${oneLine(check.label)}: ${oneLine(check.message)}`);
    if (check.status === 'pass') continue;
    for (const evidence of check.evidence.slice(0, 3)) {
      lines.push(`      ${oneLine(formatEvidence(evidence))}`);
    }
    if (check.evidence.length > 3) {
      lines.push(`      … ${check.evidence.length - 3} more evidence entries in the structured report`);
    }
  }
  return lines.join('\n');
}

/** Ordinary CLI codes; future agent adapters must translate these to hook semantics. */
export function healthExitCode(report: HealthReport): 0 | 1 | 2 {
  return report.status === 'pass' ? 0 : report.status === 'fail' ? 1 : 2;
}

/** Jev remains advisory regardless of its choice, confidence, or availability. */
export function combinedExitCode(report: CombinedReport): 0 | 1 | 2 {
  return healthExitCode(report.health);
}

export function formatCombinedReport(
  report: CombinedReport,
  options: { includeEvidence?: boolean } = {},
): string {
  const lines = [
    `UI check (${(report.timingsMs.total / 1_000).toFixed(2)}s total)`,
    formatHealthReport(report.health),
    '',
  ];
  const { jev } = report;
  if (jev.status !== 'evaluated') {
    lines.push(`? Jev advisory — ${jev.status}: ${oneLine(jev.message)}`);
    lines.push('  No semantic verdict is available; this is not a semantic pass.');
  } else {
    lines.push(`? Jev advisory — ${oneLine(jev.response.model)} (${(jev.durationMs / 1_000).toFixed(2)}s)`);
    const labels: Record<IntentCheckId, string> = {
      intent: 'Prompt intent',
      unexpectedChanges: 'Unexpected changes',
      regression: 'Regression',
    };
    for (const id of Object.keys(labels) as IntentCheckId[]) {
      const answer = jev.response.answers[id];
      const choice = answer.choice === 'insufficient_evidence' ? 'insufficient evidence' : answer.choice;
      // Show the actual distribution values. No unbenchmarked confidence threshold.
      lines.push(`  ? ${labels[id]}: ${choice} (probability ${answer.probabilities[answer.choice].toFixed(3)}, confidence ${answer.confidence.toFixed(3)})`);
    }
    if (options.includeEvidence) {
      lines.push('', '  Input evidence shared by the three questions (not per-answer citations):');
      for (const line of jev.evidenceState.split('\n')) lines.push(`    ${oneLine(line)}`);
    } else {
      lines.push('  Exact input evidence: report.jev.evidenceState; use includeEvidence to display it.');
    }
  }
  lines.push(`Exit code: ${combinedExitCode(report)} (browser health only; Jev is advisory).`);
  return lines.join('\n');
}
