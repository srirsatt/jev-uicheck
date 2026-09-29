// file that stores browser state (before + after) into a json file for comparison by jev 
import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PageState } from './browser/capture-state.js';

export interface BaselineKey {
  taskId: string; // One user prompt, including all of its repair attempts.
  checkpointId: string; // Same scenario, viewport, and auth setup on both sides.
  url: string; // Requested route; a redirect is recorded separately in PageState.
}

export interface Baseline {
  version: 1;
  key: BaselineKey;
  prompt: string;
  state: PageState;
}

function identity(key: BaselineKey): string {
  if (![key.taskId, key.checkpointId, key.url].every((value) => typeof value === 'string' && value.length > 0)) {
    throw new Error('A baseline needs a task ID, checkpoint ID, and URL.');
  }
  return JSON.stringify([key.taskId, key.checkpointId, key.url]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isBaseline(value: unknown): value is Baseline {
  if (!isRecord(value) || value.version !== 1 || typeof value.prompt !== 'string') return false;
  const { key, state } = value;
  return isRecord(key) && ['taskId', 'checkpointId', 'url'].every((field) => typeof key[field] === 'string')
    && isRecord(state) && ['url', 'title', 'ariaSnapshot', 'capturedAt'].every((field) => typeof state[field] === 'string');
}

function hasCode(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}

/** Local snapshots survive separate CLI/hook processes. First baseline wins. */
export class BaselineStore {
  constructor(private readonly directory: string) {}

  private path(key: BaselineKey): string {
    const hash = createHash('sha256').update(identity(key)).digest('hex');
    return join(this.directory, `${hash}.json`);
  }

  async load(key: BaselineKey): Promise<Baseline | undefined> {
    let text: string;
    try {
      text = await readFile(this.path(key), 'utf8');
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return undefined;
      throw error;
    }
    const value: unknown = JSON.parse(text);
    if (!isBaseline(value) || identity(value.key) !== identity(key)) {
      throw new Error('Invalid baseline file; refusing to compare mismatched evidence.');
    }
    return value;
  }

  async save(key: BaselineKey, prompt: string, state: PageState): Promise<'saved' | 'existing'> {
    const destination = this.path(key);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = `${destination}.${randomUUID()}.tmp`;
    const baseline: Baseline = { version: 1, key, prompt, state };
    try {
      await writeFile(temporary, JSON.stringify(baseline, null, 2), { flag: 'wx', mode: 0o600 });
      // Publish a fully written file atomically, without replacing an existing baseline.
      try {
        await link(temporary, destination);
        return 'saved';
      } catch (error) {
        if (hasCode(error, 'EEXIST')) return 'existing';
        throw error;
      }
    } finally {
      await unlink(temporary).catch((error: unknown) => {
        if (!hasCode(error, 'ENOENT')) throw error;
      });
    }
  }
}
