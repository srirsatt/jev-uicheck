import assert from 'node:assert/strict';
import test from 'node:test';
import { buildIntentRequest } from '../dist/checks/questions.js';
import { evaluateIntent } from '../dist/jev.js';

const preparation = buildIntentRequest({
  version: 1, key: { taskId: 'test', checkpointId: 'login', url: 'http://localhost/login' },
  prompt: 'Rename the login button to Continue',
  state: { url: 'http://localhost/login', title: 'Login', capturedAt: 'now', ariaSnapshot: '- button "Log in"' },
}, {
  status: 'complete', metadata: [], changes: [{ kind: 'changed',
    before: [{ line: 1, text: '- button "Log in"' }], after: [{ line: 1, text: '- button "Continue"' }],
  }],
});

function responseData() {
  return {
    model: 'jev-1.13.0',
    answers: Object.fromEntries(['intent', 'unexpectedChanges', 'regression'].map((id) => [id, {
      type: 'choice', choice: 'satisfied', confidence: 0.8,
      probabilities: { satisfied: 0.9, violated: 0.02, insufficient_evidence: 0.08 },
    }])),
    usage: { input_tokens: 100, output_tokens: 25 },
  };
}

test('sends one batched authenticated request and retains probabilities plus input evidence', async () => {
  let calls = 0;
  const result = await evaluateIntent(preparation, { apiKey: 'test-only-key', fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer test-only-key');
    assert.equal(options.redirect, 'error');
    assert.deepEqual(JSON.parse(options.body), { model: 'jev-1.13.0', ...preparation.request });
    return Response.json(responseData());
  } });
  assert.equal(calls, 1);
  assert.equal(result.status, 'evaluated');
  assert.equal(result.mode, 'advisory');
  assert.deepEqual(result.response, responseData());
  assert.equal(result.evidenceState, preparation.request.state);
  assert.ok(!JSON.stringify(result).includes('test-only-key'));
});

test('missing evidence, missing credentials, and oversized input never send a request', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error('Must not call'); };
  assert.equal((await evaluateIntent({ status: 'cannot-evaluate', mode: 'advisory', message: 'Missing baseline', reason: 'no-baseline' }, { fetchImpl })).status, 'skipped');
  assert.equal((await evaluateIntent(preparation, { apiKey: '', fetchImpl })).reason, 'configuration');
  assert.equal((await evaluateIntent(preparation, { apiKey: 'test', timeoutMs: Infinity, fetchImpl })).reason, 'configuration');
  const huge = structuredClone(preparation);
  huge.request.state = '界'.repeat(10_000); // Byte limit must account for multibyte text.
  assert.equal((await evaluateIntent(huge, { apiKey: 'test', fetchImpl })).reason, 'request-too-large');
  assert.equal(calls, 0);
});

test('HTTP failures stay unavailable, do not retry, and do not expose response bodies', async () => {
  for (const status of [401, 403, 422, 429, 500, 529]) {
    let calls = 0;
    const result = await evaluateIntent(preparation, { apiKey: 'test', fetchImpl: async () => {
      calls++;
      return new Response('sensitive echoed request', { status });
    } });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.httpStatus, status);
    assert.equal(calls, 1);
    assert.ok(!JSON.stringify(result).includes('sensitive'));
  }
});

test('rejects malformed JSON and incomplete or inconsistent model answers', async () => {
  const malformed = await evaluateIntent(preparation, { apiKey: 'test', fetchImpl: async () => new Response('not JSON') });
  assert.equal(malformed.reason, 'invalid-response');
  const mutations = [
    (value) => { delete value.answers.intent; },
    (value) => { value.answers.intent.choice = 'invented'; },
    (value) => { value.answers.intent.confidence = 2; },
    (value) => { value.answers.intent.probabilities.satisfied = -1; },
    (value) => { value.answers.intent.probabilities.satisfied = 0.5; },
    (value) => { value.answers.intent.choice = 'violated'; },
    (value) => { value.usage.input_tokens = -1; },
  ];
  for (const mutate of mutations) {
    const value = responseData();
    mutate(value);
    const result = await evaluateIntent(preparation, { apiKey: 'test', fetchImpl: async () => Response.json(value) });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.reason, 'invalid-response');
  }
});

test('an insufficient-evidence answer is retained without inventing a pass/fail threshold', async () => {
  const value = responseData();
  value.answers.intent = { type: 'choice', choice: 'insufficient_evidence', confidence: 0.95,
    probabilities: { satisfied: 0.01, violated: 0.01, insufficient_evidence: 0.98 } };
  const result = await evaluateIntent(preparation, { apiKey: 'test', fetchImpl: async () => Response.json(value) });
  assert.equal(result.status, 'evaluated');
  assert.equal(result.response.answers.intent.choice, 'insufficient_evidence');
  assert.equal(result.mode, 'advisory');
});

test('network errors omit raw exception details and timeouts abort the request', async () => {
  const network = await evaluateIntent(preparation, { apiKey: 'test', fetchImpl: async () => { throw new Error('secret transport details'); } });
  assert.equal(network.reason, 'network');
  assert.ok(!network.message.includes('secret'));
  let aborted = false;
  const timed = await evaluateIntent(preparation, { apiKey: 'test', timeoutMs: 10,
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => { aborted = true; reject(new Error('abort')); }, { once: true });
    }),
  });
  assert.equal(timed.reason, 'timeout');
  assert.equal(aborted, true);
});
