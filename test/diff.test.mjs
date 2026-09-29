import assert from 'node:assert/strict';
import test from 'node:test';
import { diffPageStates } from '../dist/checks/diff.js';

const state = (ariaSnapshot, extra = {}) => ({
  url: 'http://localhost:3000/login', title: 'Login',
  capturedAt: '2026-09-26T00:00:00Z', ariaSnapshot, ...extra,
});

test('identical snapshots ignore timestamps and line-ending differences', () => {
  const diff = diffPageStates(state('- button "Log in"\r\n'), state('- button "Log in"', { capturedAt: 'later' }));
  assert.deepEqual(diff, { status: 'complete', changes: [], metadata: [] });
});

test('inserting a line does not mark subsequent unchanged controls as changed', () => {
  const diff = diffPageStates(
    state('- heading "Login"\n- button "Log in"'),
    state('- heading "Login"\n- checkbox "Remember me"\n- button "Log in"'),
  );
  assert.deepEqual(diff.changes, [{ kind: 'added', before: [], after: [{ line: 2, text: '- checkbox "Remember me"' }] }]);
});

test('changed blocks retain exact BEFORE and AFTER source lines', () => {
  const diff = diffPageStates(
    state('- heading "Login"\n- button "Log in"\n- link "Help"'),
    state('- heading "Login"\n- button "Continue"\n- link "Help"'),
  );
  assert.deepEqual(diff.changes, [{
    kind: 'changed',
    before: [{ line: 2, text: '- button "Log in"' }],
    after: [{ line: 2, text: '- button "Continue"' }],
  }]);
});

test('duplicate labels, removals, nesting changes, and empty states remain observable', () => {
  const duplicates = diffPageStates(state('- button "Save"\n- button "Save"'), state('- button "Save"'));
  assert.equal(duplicates.changes[0].kind, 'removed');
  assert.equal(duplicates.changes[0].before.length, 1);
  const nesting = diffPageStates(state('- group:\n  - button "Save"'), state('- group:\n- button "Save"'));
  assert.equal(nesting.changes[0].kind, 'changed');
  assert.equal(diffPageStates(state(''), state('- button "Save"')).changes[0].kind, 'added');
  assert.equal(diffPageStates(state('- button "Save"'), state('')).changes[0].kind, 'removed');
});

test('URL and title changes are reported even when the ARIA snapshot is identical', () => {
  const diff = diffPageStates(state(''), state('', { url: 'http://localhost:3000/reset', title: 'Reset' }));
  assert.equal(diff.changes.length, 0);
  assert.deepEqual(diff.metadata.map((change) => change.field), ['url', 'title']);
});

test('exceeding the diff budget is incomplete, never an empty successful diff', () => {
  const large = Array.from({ length: 2_001 }, (_, i) => `- text: ${i}`).join('\n');
  assert.equal(diffPageStates(state(''), state(large)).status, 'incomplete');
});
