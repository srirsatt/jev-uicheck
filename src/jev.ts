import { performance } from 'node:perf_hooks';
import type { IntentAnswer, IntentCheckId, IntentPreparation, IntentRequest } from './checks/questions.js';

const endpoint = 'https://api.typesafe.ai/v1/systemone';
const model = 'jev-1.13.0';
const checkIds: IntentCheckId[] = ['intent', 'unexpectedChanges', 'regression'];
const choices: IntentAnswer[] = ['satisfied', 'violated', 'insufficient_evidence'];

export interface JevAnswer {
  type: 'choice';
  choice: IntentAnswer;
  probabilities: Record<IntentAnswer, number>;
  confidence: number;
}

interface JevResponse {
  model: string;
  answers: Record<IntentCheckId, JevAnswer>;
  usage: { input_tokens: number; output_tokens: number };
}

export type JevResult = { mode: 'advisory'; durationMs: number } & (
  | { status: 'evaluated'; response: JevResponse; evidenceState: string }
  | { status: 'skipped'; message: string }
  | {
    status: 'unavailable';
    reason: 'configuration' | 'request-too-large' | 'timeout' | 'network' | 'http' | 'invalid-response';
    message: string;
    httpStatus?: number;
  }
);

export interface JevOptions {
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch; // Dependency injection for tests; production uses Node fetch.
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function probability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}


/** Validate external data before any downstream code can use the decision. */

// external dating being our playwright ARIA checks
function parseResponse(value: unknown): JevResponse | undefined {
  if (!record(value) || typeof value.model !== 'string' || !value.model.trim()
    || !record(value.answers) || !record(value.usage)) return undefined;
  if (Object.keys(value.answers).length !== checkIds.length) return undefined;
  const answers = {} as Record<IntentCheckId, JevAnswer>;
  for (const id of checkIds) {
    const answer = value.answers[id];
    if (!record(answer) || answer.type !== 'choice' || !probability(answer.confidence)
      || !choices.includes(answer.choice as IntentAnswer) || !record(answer.probabilities)) return undefined;
    const probabilities = answer.probabilities;
    if (Object.keys(probabilities).length !== choices.length
      || !choices.every((choice) => probability(probabilities[choice]))) return undefined;
    const numbers = choices.map((choice) => probabilities[choice] as number);
    if (Math.abs(numbers.reduce((sum, number) => sum + number, 0) - 1) > 0.01) return undefined;
    const choice = answer.choice as IntentAnswer;
    if ((probabilities[choice] as number) + 0.000001 < Math.max(...numbers)) return undefined;
    answers[id] = {
      type: 'choice', choice, confidence: answer.confidence,
      probabilities: Object.fromEntries(choices.map((key) => [key, probabilities[key]])) as Record<IntentAnswer, number>,
    };
  }
  const { input_tokens, output_tokens } = value.usage;
  if (typeof input_tokens !== 'number' || !Number.isSafeInteger(input_tokens) || input_tokens < 0
    || typeof output_tokens !== 'number' || !Number.isSafeInteger(output_tokens) || output_tokens < 0) return undefined;
  return { model: value.model, answers, usage: { input_tokens, output_tokens } };
}

function fitsLocalBudget(request: IntentRequest, body: string): boolean {

  // jev 32k token lim -> checker


  // Conservative local BYTE limits, not a claim to count Jev's tokens.
  // Leave space for provider serialization; provider context errors remain explicit.
  return Buffer.byteLength(body, 'utf8') <= 60_000
    && Object.values(request.questions).every((question) =>
      Buffer.byteLength(request.state, 'utf8') + Buffer.byteLength(JSON.stringify(question), 'utf8') <= 28_000);
}

/** One batched request. No automatic retries or effect on deterministic exit codes. */

// jev q checker
export async function evaluateIntent(preparation: IntentPreparation, options: JevOptions = {}): Promise<JevResult> {
  const started = performance.now();
  const finish = <T extends object>(result: T) => ({ ...result, mode: 'advisory' as const, durationMs: performance.now() - started });
  if (preparation.status === 'cannot-evaluate') {
    return finish({ status: 'skipped' as const, message: preparation.message });
  }
  const apiKey = (options.apiKey ?? process.env.TYPESAFE_API_KEY)?.trim();
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (!apiKey || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000) {
    return finish({ status: 'unavailable' as const, reason: 'configuration' as const,
      message: 'Set TYPESAFE_API_KEY and use a timeout between 1 and 120000 ms.' });
  }
  const body = JSON.stringify({ model, ...preparation.request });
  if (!fitsLocalBudget(preparation.request, body)) {
    return finish({ status: 'unavailable' as const, reason: 'request-too-large' as const,
      message: 'The prepared request exceeds the local payload budget; reduce its scope. Evidence was not truncated.' });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.fetchImpl ?? fetch)(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body, signal: controller.signal, redirect: 'error',
    });
    if (!response.ok) {
      // Do not expose response bodies: a provider may echo request data into errors.
      await response.body?.cancel();
      const hint = response.status === 401 || response.status === 403 ? 'Check the TypeSafe key and account access.'
        : response.status === 429 ? 'TypeSafe rate limit reached.'
          : response.status >= 500 ? 'TypeSafe is temporarily unavailable.' : 'TypeSafe rejected the request.';
      return finish({ status: 'unavailable' as const, reason: 'http' as const,
        httpStatus: response.status, message: `Jev HTTP ${response.status}. ${hint}` });
    }
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      if (controller.signal.aborted) throw new Error('Aborted');
      return finish({ status: 'unavailable' as const, reason: 'invalid-response' as const,
        message: 'Jev returned invalid JSON.' });
    }
    const parsed = parseResponse(value);
    if (!parsed) return finish({ status: 'unavailable' as const, reason: 'invalid-response' as const,
      message: 'Jev returned missing or invalid answers, probabilities, confidence, or usage.' });
    return finish({ status: 'evaluated' as const, response: parsed, evidenceState: preparation.request.state });
  } catch {
    // Never return raw transport errors, which can include headers or request data.
    return finish({ status: 'unavailable' as const, reason: controller.signal.aborted ? 'timeout' as const : 'network' as const,
      message: controller.signal.aborted ? 'Jev request timed out.' : 'Could not reach the Jev API.' });
  } finally {
    clearTimeout(timeout);
  }
}
