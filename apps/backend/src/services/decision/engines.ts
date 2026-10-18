import { logger } from '@/utils/logger';
import { requestJevAnswers, type JevAnswer, type JevFailure, type JevQuestion } from '@/services/queryIntent/jevClient';
import { requestLlmAnswers } from './llmDecision';
import { classifierTarget, isEngineConfigured } from './targets';
import type { ClassifierEngine, DecisionEngine, DecisionFeature, DecisionTask, EngineRun, LlmReply, RunOutcome } from './types';

const CLASSIFIER_TIMEOUT_MS = 10_000;

// Tasks carry customer content, so a classifier only when it is the deployer's own.
const targetOf = (engine: ClassifierEngine) =>
  isEngineConfigured(engine, { customerContent: true }) ? classifierTarget(engine) : null;

export const elapsedSince = (startedAt: number): number => Math.round(performance.now() - startedAt);

/**
 * How sure the classifier was of `answer`, from 0.5 (a coin flip) to 1: the probability of a
 * choice or level, or a yes/no's distance from even. Undefined when it gave no probability.
 */
export const answerConfidence = (answer: JevAnswer): number | undefined => {
  if (answer.type === 'noul') return Math.max(answer.noul, 1 - answer.noul);
  if (answer.type === 'choice') return answer.confidence ?? answer.probabilities[answer.choice];
  return answer.confidence;
};

/** A task asks one question; with several, the least sure answer speaks for them all. */
const leastConfidence = (answers: Record<string, JevAnswer>): number | undefined => {
  const confidences = Object.values(answers).map(answerConfidence);
  return confidences.length > 0 && confidences.every((c) => c !== undefined)
    ? Math.min(...(confidences as number[]))
    : undefined;
};

/** A reply without a usable answer is an abstention; no reply at all is a failure. */
export const classifierOutcome = (answered: boolean, failure: JevFailure | undefined): RunOutcome =>
  answered ? 'answered' : failure && failure.kind !== 'unusable' ? 'failed' : 'abstained';

/** One engine's answer to `task`. Never throws: a failure is the run's outcome. */
export const runEngine = <T>(engine: DecisionEngine, task: DecisionTask<T>): Promise<EngineRun<T>> =>
  engine === 'llm' ? runLlm(task.feature, () => task.askLlm()) : runClassifier(engine, task);

async function runClassifier<T>(engine: ClassifierEngine, task: DecisionTask<T>): Promise<EngineRun<T>> {
  const target = targetOf(engine);
  if (!target || !task.question) {
    return { engine, outcome: 'unavailable', answer: null, latencyMs: 0 };
  }

  const startedAt = performance.now();
  let failure: JevFailure | undefined;
  const answers = await requestJevAnswers(task.question.state, task.question.questions, CLASSIFIER_TIMEOUT_MS, undefined, {
    target,
    onFailure: (f) => {
      failure = f;
    },
  });
  const latencyMs = elapsedSince(startedAt);
  const answer = answers ? task.readAnswers(answers, engine) : null;
  const outcome = classifierOutcome(answer !== null, failure);
  const confidence = answers && answer !== null ? leastConfidence(answers) : undefined;
  return { engine, outcome, answer, latencyMs, model: target.model, confidence };
}

/** The LLM's answer through `askLlm`. Never throws: a failure is the run's outcome. */
export async function runLlm<T>(feature: DecisionFeature, askLlm: () => Promise<LlmReply<T>>): Promise<EngineRun<T>> {
  const startedAt = performance.now();
  try {
    const { answer, model, usage } = await askLlm();
    return {
      engine: 'llm',
      outcome: answer === null ? 'abstained' : 'answered',
      answer,
      latencyMs: elapsedSince(startedAt),
      model,
      promptTokens: usage?.promptTokens,
      completionTokens: usage?.completionTokens,
    };
  } catch (error) {
    logger.warn('[Decision] LLM run failed', {
      feature,
      error: error instanceof Error ? error.message : String(error),
    });
    return { engine: 'llm', outcome: 'failed', answer: null, latencyMs: elapsedSince(startedAt), error };
  }
}

export interface AskOptions {
  /** Leave out an unusable answer instead of failing the whole batch; see requestJevAnswers. */
  partial?: boolean;
  onFailure?: (failure: JevFailure) => void;
}

type Ask = (
  feature: DecisionFeature,
  state: string | Record<string, unknown>,
  questions: Record<string, JevQuestion>,
  timeoutMs: number,
  signal?: AbortSignal,
  options?: AskOptions
) => Promise<EngineRun<Record<string, JevAnswer>>>;

/** A classifier over the Jev wire format, at `engine`'s endpoint. */
const askClassifier =
  (engine: ClassifierEngine): Ask =>
  async (_feature, state, questions, timeoutMs, signal, { partial = false, onFailure } = {}) => {
    const target = classifierTarget(engine);
    const startedAt = performance.now();
    let failure: JevFailure | undefined;
    const answer = await requestJevAnswers(state, questions, timeoutMs, signal, {
      partial,
      target,
      onFailure: (f) => {
        failure = f;
        onFailure?.(f);
      },
    });
    const outcome = classifierOutcome(answer !== null, failure);
    return { engine, outcome, answer, latencyMs: elapsedSince(startedAt), model: target.model };
  };

export const askXor: Ask = askClassifier('xor');

export const askJev: Ask = askClassifier('jev');

/** The LLM given the same typed questions, under the same all-or-nothing rule unless `partial`. */
export const askLlm: Ask = async (feature, state, questions, timeoutMs, _signal, { partial = false, onFailure } = {}) => {
  const run = await runLlm(feature, () => requestLlmAnswers(state, questions, timeoutMs));
  const complete = Object.keys(questions).every((id) => run.answer?.[id]);
  if (run.answer && !partial && !complete) {
    onFailure?.({ kind: 'unusable' });
    return { ...run, outcome: 'abstained', answer: null };
  }
  if (run.outcome !== 'answered') onFailure?.(run.outcome === 'failed' ? { kind: 'network' } : { kind: 'unusable' });
  return run;
};

const ASK: Record<DecisionEngine, Ask> = { xor: askXor, jev: askJev, llm: askLlm };

/** `engine`'s answers to typed questions. Never throws: a failure is the run's outcome. */
export const askEngine = (engine: DecisionEngine, ...args: Parameters<Ask>): ReturnType<Ask> => ASK[engine](...args);
