// differences (line by line literally) through ARIA before + after

import { diffLines } from 'diff';
import type { PageState } from '../browser/capture-state.js';

export interface SnapshotLine {
  line: number; // One-based line in the corresponding original snapshot.
  text: string;
}

export interface SnapshotChange {
  kind: 'added' | 'removed' | 'changed';
  before: SnapshotLine[];
  after: SnapshotLine[];
}

export type StateDiff =
  | { status: 'complete'; changes: SnapshotChange[]; metadata: { field: 'url' | 'title'; before: string; after: string }[] }
  | { status: 'incomplete'; reason: string };

/** A text diff, not element identity matching or a correctness verdict. */
export function diffPageStates(before: PageState, after: PageState): StateDiff {
  const parts = diffLines(before.ariaSnapshot, after.ariaSnapshot, {
    stripTrailingCr: true,
    ignoreNewlineAtEof: true,
    // Preserve indentation: it represents accessibility-tree nesting.
    timeout: 50,
    maxEditLength: 2_000,
  });
  if (!parts) return { status: 'incomplete', reason: 'Snapshot diff exceeded its work limit.' };

  const changes: SnapshotChange[] = [];
  let beforeLine = 1;
  let afterLine = 1;
  let pending: SnapshotChange | undefined;

  const flush = () => {
    if (!pending) return;
    pending.kind = pending.before.length === 0 ? 'added' : pending.after.length === 0 ? 'removed' : 'changed';
    changes.push(pending);
    pending = undefined;
  };

  for (const part of parts) {
    if (!part.added && !part.removed) {
      flush();
      beforeLine += part.count;
      afterLine += part.count;
      continue;
    }
    pending ??= { kind: 'changed', before: [], after: [] };
    const lines = part.value.replace(/\n$/, '').split('\n');
    for (const text of lines) {
      if (part.removed) pending.before.push({ line: beforeLine++, text });
      else pending.after.push({ line: afterLine++, text });
    }
  }
  flush();

  const metadata: Extract<StateDiff, { status: 'complete' }>['metadata'] = [];
  for (const field of ['url', 'title'] as const) {
    if (before[field] !== after[field]) metadata.push({ field, before: before[field], after: after[field] });
  }
  return { status: 'complete', changes, metadata };
}
