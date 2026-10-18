import { recordRun, type RunRole } from '@/services/otel/decisionMetrics';
import { asNoulQuestions, readNouls } from './classifierClient';
import type { DecisionAnswer, YesNoQuestion, DecisionQuestion } from './types';
import { askEngine, type AskOptions } from './engines';
import { compareInBackground } from './evaluation';
import { configuredEngine, isEngineConfigured } from './targets';
import type { QuestionFeature } from './types';

export interface AskDecisionOptions extends AskOptions {
  /** shadow: asked alongside a live LLM, so the answer is not the one users get. */
  role?: RunRole;
}

/**
 * Typed questions about `state`, answered by the configured engine (DECISION_ENGINE) and
 * measured as `feature`: every call counts toward that engine's latency and outcome, and a live
 * one is queued to be put to the other engines as well. Every engine answers in the same shapes, under
 * the same rules as requestClassifierAnswers. Never throws.
 */
export async function askDecision(
  feature: QuestionFeature,
  state: string | Record<string, unknown>,
  questions: Record<string, DecisionQuestion>,
  timeoutMs: number,
  signal?: AbortSignal,
  { role = 'live', ...options }: AskDecisionOptions = {}
): Promise<Record<string, DecisionAnswer> | null> {
  const engine = configuredEngine();
  if (!isEngineConfigured(engine)) return null;

  const run = await askEngine(engine, feature, state, questions, timeoutMs, signal, options);
  // Cancelled by the caller: says nothing about the engine.
  if (signal?.aborted) return run.answer;

  recordRun(feature, run, role);
  // A shadow answer was never shown to anyone, so it can't stand in for the live one.
  if (role === 'live') compareInBackground(feature, engine, state, questions, run.answer);
  return run.answer;
}

/** Yes/no questions through askDecision: P(yes) per question, null unless every answer is usable. */
export const askDecisionNouls = async (
  feature: QuestionFeature,
  state: string,
  questions: Record<string, YesNoQuestion>,
  timeoutMs: number
): Promise<Record<string, number> | null> =>
  readNouls(await askDecision(feature, state, asNoulQuestions(questions), timeoutMs));
