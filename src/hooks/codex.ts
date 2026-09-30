import { browserServices, handleHook } from './lifecycle.js';

/** Codex's command-hook protocol shares these events and JSON decisions with Claude.
 * The lifecycle isolates its sessions and recognizes synthetic repair prompts.
 */
export async function handleCodexHook(project: string, value: unknown, services = browserServices) {
  return handleHook(project, value, services, 'codex');
}
