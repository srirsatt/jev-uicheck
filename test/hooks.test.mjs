import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { installClaudeHooks, installCodexHooks, parseConfig } from '../dist/hooks/config.js';
import { handleClaudeHook, confirmedErrors } from '../dist/hooks/claude.js';
import { handleCodexHook } from '../dist/hooks/codex.js';
import { evaluatePageHealth } from '../dist/checks/universal.js';

const cli = resolve('dist/cli.js');
const capture = (events = [], status = 'captured') => ({
  status, requestedUrl: 'http://localhost:3000/login',
  ...(status === 'captured' ? { state: { url: 'http://localhost:3000/login', title: 'Login', ariaSnapshot: '- heading "Login"', capturedAt: 'now' } }
    : { error: { stage: 'navigation', message: 'Server unavailable' } }),
  evidence: { events, droppedEvents: 0 }, timingsMs: { total: 1, navigation: 1, readiness: 0, snapshot: 0 },
});
const error = { kind: 'console-error', message: 'Broken submit', url: 'http://localhost:3000/login', line: 1, observedAt: 'now' };
const violation = { type: 'choice', choice: 'violated', probabilities: { satisfied: 0, violated: 1, insufficient_evidence: 0 }, confidence: 1 };
function result(first, second = first) {
  return {
    comparison: { status: 'compared', capture: first }, confirmation: second,
    report: { health: evaluatePageHealth(first), timingsMs: { total: 1, diff: 0, jev: 0 }, jev: {
      status: 'evaluated', mode: 'advisory', durationMs: 0, evidenceState: 'fixture',
      response: { model: 'test', answers: { intent: violation, regression: violation, unexpectedChanges: violation }, usage: { input_tokens: 1, output_tokens: 1 } },
    } },
  };
}
for (const { agent, install, handle } of [
  { agent: 'claude', install: installClaudeHooks, handle: handleClaudeHook },
  { agent: 'codex', install: installCodexHooks, handle: handleCodexHook },
]) {
const settingsFile = agent === 'codex' ? '.codex/hooks.json' : '.claude/settings.local.json';
const agentDir = agent === 'codex' ? '.codex' : '.claude';
const check = (name, fn) => test(`${agent}: ${name}`, fn);
async function project(t) {
  const root = await mkdtemp(join(tmpdir(), "jev hook ' $test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await install(root, 'http://localhost:3000/login', 'h1', cli);
  return root;
}
const input = (event, extra = {}) => ({ ...(agent === 'codex' ? { turn_id: 'turn-1' } : {}), session_id: 'session/../../isolated', hook_event_name: event, ...extra });
async function statePath(root) {
  const base = join(root, '.jev-uicheck-fast/sessions');
  return join(base, (await readdir(base))[0], 'turn.json');
}
const read = async (path) => JSON.parse(await readFile(path, 'utf8'));

// Fake only the browser/service boundary here; filesystem, state machine, and hook protocol are real.
check('hook repairs are capped durably across calls and keep the original baseline', async (t) => {
  const root = await project(t);
  const keys = [];
  let broken = true;
  const services = { before: async () => capture(), after: async (_config, store, key) => {
    keys.push(key);
    assert.equal((await store.load(key)).prompt, 'Fix login');
    return result(capture(broken ? [error] : []));
  } };
  await handle(root, input('UserPromptSubmit', { prompt: 'Fix login' }), services);
  const path = await statePath(root);
  const baselineKey = (await read(path)).key;
  for (let retry = 1; retry <= 3; retry++) {
    const feedback = await handle(root, input('Stop', { stop_hook_active: retry > 1 }), services);
    assert.equal(feedback.decision, 'block');
    assert.match(feedback.reason, new RegExp(`repair ${retry}/3`));
    assert.equal((await read(path)).retries, retry);
  }
  const exhausted = await handle(root, input('Stop', { stop_hook_active: true }), services);
  assert.equal(exhausted.decision, undefined);
  assert.match(exhausted.systemMessage, /Retry limit.*Failures remain/);
  assert.ok(keys.every((key) => key.taskId === baselineKey.taskId));
  assert.deepEqual(await handle(root, input('Stop', { stop_hook_active: true }), services), {});
  // New tool activity does not reset the exhausted budget.
  await handle(root, input('PostToolUse'), services);
  assert.equal((await handle(root, input('Stop'), services)).decision, undefined);
  assert.equal((await read(path)).retries, 3);
  // The next user prompt gets a new baseline and budget.
  await handle(root, input('UserPromptSubmit', { prompt: 'Fix login' }), services);
  assert.notEqual((await read(path)).key.taskId, baselineKey.taskId);
  assert.equal((await read(path)).retries, 0);
  broken = false;
  const fixed = await handle(root, input('Stop'), services);
  assert.equal(fixed.decision, undefined); // Even three certain Jev violations cannot block.
  assert.match(fixed.systemMessage, /Browser health passed/);
});

check('unhealthy BEFORE, incomplete captures, and transient errors cannot trigger repairs', async (t) => {
  const root = await project(t);
  for (const [before, first, second] of [
    [capture([error]), capture([error]), capture([error])],
    [capture([], 'incomplete'), capture([error]), capture([error])],
    [capture(), capture([error]), capture()],
    [capture(), capture([error]), capture([], 'incomplete')],
    [capture(), capture([error]), capture([{ ...error, message: 'Different error' }])],
  ]) {
    const services = { before: async () => before, after: async () => result(first, second) };
    await handle(root, input('UserPromptSubmit', { prompt: 'Change login' }), services);
    const output = await handle(root, input('Stop'), services);
    assert.equal(output.decision, undefined);
    assert.match(output.systemMessage, /repair withheld/);
  }
  const truncated = capture([error]);
  truncated.evidence.droppedEvents = 1;
  assert.deepEqual(confirmedErrors(capture([error]), truncated), []);
});

check('failed prompt capture invalidates old state; sessions and subagents cannot replace its baseline', async (t) => {
  const root = await project(t);
  const services = { before: async () => capture(), after: async () => result(capture()) };
  await handle(root, input('UserPromptSubmit', { prompt: 'First' }), services);
  const path = await statePath(root);
  const first = await read(path);
  await handle(root, input('UserPromptSubmit', { prompt: 'Child', agent_id: 'child' }), services);
  assert.deepEqual(await read(path), first);
  assert.match((await handle(root, { ...input('Stop'), session_id: 'other' }, services)).systemMessage, /no prompt baseline/);
  await assert.rejects(handle(root, input('UserPromptSubmit', { prompt: 'Second' }), {
    ...services, before: async () => { throw new Error('Browser unavailable'); },
  }));
  const next = await read(path);
  assert.notEqual(next.key.taskId, first.key.taskId);
  assert.equal(next.baselineReady, false);
  await writeFile(join(root, 'uicheck.config.json'), '{}');
  await assert.rejects(handle(root, input('UserPromptSubmit', { prompt: 'Third' }), services));
  assert.equal(await read(path), null);
});

check('config changes suspend the turn; parallel tool hooks preserve the repair budget', async (t) => {
  const root = await project(t);
  const services = { before: async () => capture(), after: async () => result(capture([error])) };
  await handle(root, input('UserPromptSubmit', { prompt: 'Fix login' }), services);
  await handle(root, input('Stop'), services);
  await Promise.all(Array.from({ length: 5 }, () => handle(root, input('PostToolUse'), services)));
  assert.equal((await read(await statePath(root))).retries, 1);
  const config = await read(join(root, 'uicheck.config.json'));
  await writeFile(join(root, 'uicheck.config.json'), JSON.stringify({ ...config, ready: '#new' }));
  assert.match((await handle(root, input('Stop'), services)).systemMessage, /configuration changed/);
});

check('installer preserves other hooks, is idempotent, validates local configuration, and backs up settings', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'jev-install-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, agentDir));
  const old = { permissions: { allow: ['Read'] }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'custom-check' }] }] } };
  await writeFile(join(root, settingsFile), JSON.stringify(old));
  await install(root, 'http://localhost:3000/login', 'h1', cli);
  await install(root, 'http://localhost:3000/login', 'h1', cli);
  const settings = await read(join(root, settingsFile));
  assert.deepEqual(settings.permissions, old.permissions);
  assert.equal(settings.hooks.Stop.length, 2);
  assert.equal(settings.hooks.UserPromptSubmit.length, 1);
  assert.equal(settings.hooks.PostToolUse.length, 1);
  assert.deepEqual(await read(join(root, `.jev-uicheck-fast/${agent}-settings-before-install.json`)), old);
  assert.equal((await readFile(join(root, '.gitignore'), 'utf8')).match(/\.jev-uicheck-fast\//g).length, 1);
  for (const url of ['https://example.com', 'file:///tmp/app', 'http://user:secret@localhost']) {
    assert.throws(() => parseConfig({ version: 1, url, ready: 'h1' }));
  }
  assert.throws(() => parseConfig({ version: 1, url: 'http://localhost', ready: 'h1', maxRetries: 4 }));
});

function invoke(command, payload, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/sh', ['-c', command], { cwd,
      env: { ...process.env, TYPESAFE_API_KEY: '' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk) => stdout += chunk);
    child.stderr.on('data', (chunk) => stderr += chunk);
    child.on('error', reject);
    child.on('close', (code) => {
      try { assert.equal(code, 0, stderr); resolve(JSON.parse(stdout)); }
      catch (error) { reject(error); }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

check('installed hook command captures BEFORE, blocks a real browser error, then accepts the repair across processes', async (t) => {
  const root = await project(t);
  let broken = false;
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/favicon.ico') { res.writeHead(204); return res.end(); }
    res.end(`<h1>Login</h1><button>Log in</button>${broken ? '<script>console.error("Broken submit")</script>' : ''}`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const config = await read(join(root, 'uicheck.config.json'));
  await writeFile(join(root, 'uicheck.config.json'), JSON.stringify({ ...config, url: `http://127.0.0.1:${server.address().port}/login`, settleMs: 0 }));
  const settings = await read(join(root, settingsFile));
  const command = settings.hooks.Stop[0].hooks[0].command;
  const before = await invoke(command, input('UserPromptSubmit', { prompt: 'Update login' }), root);
  assert.match(before.systemMessage, /captured BEFORE/);
  const path = await statePath(root);
  const original = await read(path);
  broken = true;
  await invoke(command, input('PostToolUse', { tool_name: 'Bash' }), root);
  const blocked = await invoke(command, input('Stop'), root);
  assert.equal(blocked.decision, 'block');
  assert.match(blocked.reason, /Broken submit/);
  if (agent === 'codex') {
    // Codex may send Stop's reason back through UserPromptSubmit as a new turn.
    const continuation = await invoke(command, input('UserPromptSubmit', { prompt: blocked.reason, turn_id: 'turn-2' }), root);
    assert.match(continuation.hookSpecificOutput.additionalContext, /budget has not reset/);
  }
  broken = false;
  await invoke(command, input('PostToolUse', { tool_name: 'Edit' }), root);
  const repaired = await invoke(command, input('Stop', { stop_hook_active: true }), root);
  assert.equal(repaired.decision, undefined);
  assert.match(repaired.systemMessage, /Browser health passed/);
  assert.match(repaired.systemMessage, /Jev advisory — unavailable/);
  assert.equal((await read(path)).key.taskId, original.key.taskId);
  assert.equal((await read(path)).retries, 1);
  const taskDir = join(path, '..', original.key.taskId);
  const reports = (await readdir(taskDir)).filter((name) => name.startsWith('check-'));
  assert.equal(reports.length, 2);
  const saved = await Promise.all(reports.map((name) => read(join(taskDir, name, 'report.json'))));
  assert.ok(saved.some((report) => report.confirmedErrors.length === 1 && report.decision === 'block'));
  // Invalid stdin/config must warn, never accidentally block a user prompt via exit 2.
  assert.match((await invoke(command, {}, root)).systemMessage, /unavailable/);
});

}

test('Codex synthetic repair prompts preserve the first user prompt and exhaust the same three-repair budget', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'jev-codex-continuation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await installCodexHooks(root, 'http://localhost:3000/login', 'h1', cli);
  let captures = 0;
  const baselineKeys = [];
  const services = {
    before: async () => { captures++; return capture(); },
    after: async (_config, store, key) => {
      baselineKeys.push(key.taskId);
      assert.equal((await store.load(key)).prompt, 'Update the login form');
      return result(capture([error]));
    },
  };
  const event = (name, extra = {}) => ({ session_id: 'codex-session', hook_event_name: name, ...extra });
  await handleCodexHook(root, event('UserPromptSubmit', { prompt: 'Update the login form', turn_id: 'turn-0' }), services);
  for (let i = 1; i <= 3; i++) {
    const output = await handleCodexHook(root, event('Stop', { turn_id: `turn-${i-1}`, stop_hook_active: i > 1 }), services);
    assert.equal(output.decision, 'block');
    assert.match(output.reason, new RegExp(`repair ${i}/3`));
    const continuation = await handleCodexHook(root, event('UserPromptSubmit', { prompt: output.reason, turn_id: `turn-${i}` }), services);
    assert.match(continuation.hookSpecificOutput.additionalContext, /budget has not reset/);
    await handleCodexHook(root, event('PostToolUse', { tool_name: 'apply_patch', turn_id: `turn-${i}` }), services);
  }
  const final = await handleCodexHook(root, event('Stop', { turn_id: 'turn-3', stop_hook_active: true }), services);
  assert.equal(final.decision, undefined);
  assert.match(final.systemMessage, /Retry limit/);
  assert.equal(captures, 1);
  assert.equal(new Set(baselineKeys).size, 1);
  await handleCodexHook(root, event('UserPromptSubmit', { prompt: 'A genuinely new task', turn_id: 'turn-4' }), services);
  assert.equal(captures, 2);
});

test('installing both agents preserves each hook file and separates sessions with identical IDs', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'jev-both-agents-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await installClaudeHooks(root, 'http://localhost:3000/login', 'h1', cli);
  const claudeSettings = await readFile(join(root, '.claude/settings.local.json'), 'utf8');
  await mkdir(join(root, '.codex'));
  const toml = '[features]\nhooks = true\n';
  await writeFile(join(root, '.codex/config.toml'), toml);
  await installCodexHooks(root, 'http://localhost:3000/login', 'h1', cli);
  assert.equal(await readFile(join(root, '.claude/settings.local.json'), 'utf8'), claudeSettings);
  assert.equal(await readFile(join(root, '.codex/config.toml'), 'utf8'), toml);
  const services = { before: async () => capture(), after: async () => result(capture()) };
  const input = { session_id: 'identical', hook_event_name: 'UserPromptSubmit' };
  await handleClaudeHook(root, { ...input, prompt: 'Claude prompt' }, services);
  await handleCodexHook(root, { ...input, prompt: 'Codex prompt', turn_id: 'turn-1' }, services);
  const sessions = join(root, '.jev-uicheck-fast/sessions');
  const names = await readdir(sessions);
  assert.equal(names.length, 2);
  const baselines = await Promise.all(names.map(async (name) => {
    const dir = join(sessions, name, 'baselines');
    return JSON.parse(await readFile(join(dir, (await readdir(dir))[0]), 'utf8'));
  }));
  assert.deepEqual(new Set(baselines.map((baseline) => baseline.prompt)), new Set(['Claude prompt', 'Codex prompt']));
});
