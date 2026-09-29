import type { CheckEvidence, CheckStatus, HealthReport } from './checks/universal.js';

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
