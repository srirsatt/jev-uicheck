// Claude and Codex use the same browser checks and repair policy.
export { handleHook as handleClaudeHook, browserServices, confirmedErrors, readHookStdin } from './lifecycle.js';
export type { HookOutput } from './lifecycle.js';
