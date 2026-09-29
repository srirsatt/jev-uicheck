import { buildIntentRequest } from '../dist/checks/questions.js';
import { diffPageStates } from '../dist/checks/diff.js';
import { evaluateIntent } from '../dist/jev.js';

// Synthetic input only: no project files, real page content, or browser required.
const before = {
  url: 'http://localhost:3000/login', title: 'Login', capturedAt: new Date().toISOString(),
  ariaSnapshot: '- heading "Login"\n- button "Log in"',
};
const after = { ...before, ariaSnapshot: '- heading "Login"\n- checkbox "Remember me"\n- button "Log in"' };
const baseline = {
  version: 1, key: { taskId: 'api-smoke', checkpointId: 'login', url: before.url },
  prompt: 'Add a checkbox labeled Remember me to the login page. Keep the Log in button.',
  state: before,
};
const result = await evaluateIntent(buildIntentRequest(baseline, diffPageStates(before, after)));
if (result.status === 'evaluated') {
  console.log(`Jev connected: ${result.response.model} (${Math.round(result.durationMs)} ms, one request)`);
  for (const [id, answer] of Object.entries(result.response.answers)) {
    console.log(`${id}: ${answer.choice}; probability=${answer.probabilities[answer.choice]}, confidence=${answer.confidence}`);
  }
  console.log('Advisory only. This connection check is not an accuracy or latency benchmark.');
} else {
  console.error(`${result.status}: ${result.message}`);
  process.exitCode = 2;
}
