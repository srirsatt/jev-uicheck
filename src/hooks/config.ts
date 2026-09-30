import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface HookConfig {
  version: 1;
  url: string;
  ready: string;
  timeoutMs: number;
  settleMs: number;
  maxRetries: number;
}

export function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function readJson(path: string): Promise<unknown> {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function writeAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

export function parseConfig(value: unknown): HookConfig {
  if (!object(value) || value.version !== 1 || typeof value.url !== 'string'
    || typeof value.ready !== 'string' || !value.ready.trim()) throw new Error('Invalid uicheck.config.json.');
  const url = new URL(value.url);
  // This first adapter intentionally targets local development servers only.
  if (!['http:', 'https:'].includes(url.protocol)
    || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password) throw new Error('Use a localhost URL without embedded credentials.');
  function integer(name: string, fallback: number, min: number, max: number): number {
    const number = value && (value as Record<string, unknown>)[name] !== undefined
      ? (value as Record<string, unknown>)[name] : fallback;
    if (typeof number !== 'number' || !Number.isInteger(number) || number < min || number > max) {
      throw new Error(`Invalid ${name}: expected an integer between ${min} and ${max}.`);
    }
    return number;
  }
  return { version: 1, url: url.href, ready: value.ready,
    timeoutMs: integer('timeoutMs', 5000, 100, 10000),
    settleMs: integer('settleMs', 300, 0, 2000),
    maxRetries: integer('maxRetries', 3, 0, 3) };
}

export async function loadConfig(project: string): Promise<HookConfig> {
  return parseConfig(await readJson(join(project, 'uicheck.config.json')));
}

// POSIX quoting protects spaces, apostrophes, dollar signs, and backticks in paths.
function quote(value: string): string { return `'${value.replaceAll("'", "'\\''")}'`; }
const marker = 'Jev UI check';

/** Install only our entries, preserving unrelated agent settings and hooks. */
async function installHooks(project: string, url: string, ready: string, cliPath: string, agent: 'claude' | 'codex') {
  if (process.platform === 'win32') throw new Error('The initial hook installer supports macOS/Linux.');
  project = resolve(project);
  const configPath = join(project, 'uicheck.config.json');
  const existingConfig = await readJson(configPath);
  const config = parseConfig(existingConfig ?? { version: 1, url, ready });
  if (config.url !== new URL(url).href || config.ready !== ready) {
    throw new Error('Existing route configuration differs. Edit uicheck.config.json explicitly, then rerun setup.');
  }
  const relativeSettings = agent === 'codex' ? '.codex/hooks.json' : '.claude/settings.local.json';
  const settingsPath = join(project, relativeSettings);
  const old = await readJson(settingsPath);
  if (old !== undefined && !object(old)) throw new Error('Agent hook settings must be a JSON object.');
  const settings = { ...(old ?? {}) as Record<string, unknown> };
  if (settings.hooks !== undefined && !object(settings.hooks)) throw new Error('Invalid existing agent hooks.');
  const hooks = { ...(settings.hooks ?? {}) as Record<string, unknown> };
  const hookCommand = agent === 'codex' ? 'hook-codex' : 'hook';
  const command = `${quote(process.execPath)} ${quote(resolve(cliPath))} ${hookCommand} --project ${quote(project)}`;
  for (const event of ['UserPromptSubmit', 'PostToolUse', 'Stop']) {
    const groups = hooks[event] ?? [];
    if (!Array.isArray(groups) || groups.some((group) => !object(group) || !Array.isArray(group.hooks))) {
      throw new Error(`Invalid existing ${event} hooks.`);
    }
    hooks[event] = groups.flatMap((group: Record<string, unknown>) => {
      const remaining = (group.hooks as unknown[]).filter((hook) => !(object(hook)
        && hook.statusMessage === marker && typeof hook.command === 'string'
        && hook.command.includes(` ${hookCommand} --project `)));
      return remaining.length ? [{ ...group, hooks: remaining }] : [];
    });
    (hooks[event] as unknown[]).push({ hooks: [{ type: 'command', command, timeout: 90, statusMessage: marker }] });
  }
  // Validate everything before writing. Preserve the first settings backup on reruns.
  const stateDir = join(project, '.jev-uicheck-fast');
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  if (old !== undefined) {
    await writeFile(join(stateDir, `${agent}-settings-before-install.json`), JSON.stringify(old, null, 2),
      { mode: 0o600, flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
  }
  await writeAtomic(configPath, config);
  await writeAtomic(settingsPath, { ...settings, hooks });
  const ignorePath = join(project, '.gitignore');
  let ignore = '';
  try { ignore = await readFile(ignorePath, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const entries = ['.jev-uicheck-fast/', relativeSettings, '.env'];
  const missing = entries.filter((entry) => !ignore.split(/\r?\n/).includes(entry));
  if (missing.length) await writeFile(ignorePath, ignore + (ignore.endsWith('\n') || !ignore ? '' : '\n') + missing.join('\n') + '\n');
  return { project, configPath, settingsPath };
}

export async function installClaudeHooks(project: string, url: string, ready: string, cliPath: string) {
  return installHooks(project, url, ready, cliPath, 'claude');
}

export async function installCodexHooks(project: string, url: string, ready: string, cliPath: string) {
  // Trust remains under Codex's control: never edit trust records or bypass review.
  return installHooks(project, url, ready, cliPath, 'codex');
}
