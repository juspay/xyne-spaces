import { confidenceBucket, recordAgreement, recordRun } from '@/services/otel/decisionMetrics';
import type { DecisionAnswer, DecisionQuestion } from './types';
import {
  COMPARE_JOB,
  EVALUATE_JOB,
  decisionEvaluationQueue,
  type CompareJob,
  type EvaluateJob,
} from '@/queues/decisionEvaluationQueue';
import { answerConfidence, askEngine, runEngine, runSharedLlm } from './engines';
import { isComparisonEngineAvailable, isEngineConfigured, isSameClassifier } from './targets';
import {
  DECISION_ENGINES,
  type ComparedAnswer,
  type DecisionEngine,
  type DecisionFeature,
  type DecisionTask,
  type EngineRun,
  type QuestionFeature,
} from './types';

/** Unhurried: it only measures, and the caller's own timeout may be tuned for a live path. */
const SHADOW_TIMEOUT_MS = 30_000;

/** Queues `task` for the engines that did not answer it live; the worker runs `evaluate`. */
export function evaluateInBackground<T>(task: DecisionTask<T>, liveRuns: EngineRun<T>[]): void {
  const liveAnswers = liveRuns.filter((run) => run.outcome !== 'unavailable').map((run) => comparedAnswer(task, run));
  decisionEvaluationQueue.add(EVALUATE_JOB, { feature: task.feature, input: task.input, liveAnswers });
}

/** Queues a decision to be put to the engines that did not answer it; the worker runs `compare`. */
export function compareInBackground(
  feature: QuestionFeature,
  liveEngine: DecisionEngine,
  state: string | Record<string, unknown>,
  questions: Record<string, DecisionQuestion>,
  liveAnswers: Record<string, DecisionAnswer> | null
): void {
  decisionEvaluationQueue.add(COMPARE_JOB, { feature, liveEngine, state, questions, liveAnswers });
}

/** Asks every other configured engine the task and records how often they agree with each other. */
export async function evaluate<T>(task: DecisionTask<T>, { liveAnswers }: EvaluateJob): Promise<void> {
  const asked: DecisionEngine[] = liveAnswers.map(({ engine }) => engine);
  // Only the deployer's own engines, and not an endpoint already asked under another name.
  for (const engine of DECISION_ENGINES) {
    const available =
      isEngineConfigured(engine, { customerContent: true }) && !asked.some((other) => isSameClassifier(engine, other));
    if (available) asked.push(engine);
  }
  const shadowRuns = await Promise.all(
    asked
      .slice(liveAnswers.length)
      .map((engine) => (engine === 'llm' ? runSharedLlm(task, SHADOW_TIMEOUT_MS) : runEngine(engine, task)))
  );
  for (const run of shadowRuns) recordRun(task.feature, run, 'shadow');
  const answers = [
    ...liveAnswers,
    ...shadowRuns.filter((run) => run.outcome !== 'unavailable').map((run) => comparedAnswer(task, run)),
  ];
  recordAgreements(task.feature, answers, liveAnswers[liveAnswers.length - 1]?.engine);
}

/**
 * Asks the engines that did not answer live the same questions and records how often each
 * agrees with the live answer, and with each other, question by question.
 */
export async function compare({ feature, liveEngine, state, questions, liveAnswers }: CompareJob): Promise<void> {
  const others = DECISION_ENGINES.filter((engine) => isComparisonEngineAvailable(engine, liveEngine));
  const shadowRuns = await Promise.all(
    others.map((engine) => askEngine(engine, feature, state, questions, SHADOW_TIMEOUT_MS, undefined, { partial: true }))
  );
  const runs: Pick<EngineRun<Record<string, DecisionAnswer>>, 'engine' | 'answer' | 'model'>[] = [
    { engine: liveEngine, answer: liveAnswers },
  ];
  for (const run of shadowRuns) {
    recordRun(feature, run, 'shadow');
    runs.push(run);
  }
  for (const id of Object.keys(questions)) {
    const rows = runs.flatMap(({ engine, answer: byQuestion, model }): ComparedAnswer[] => {
      const answer = byQuestion?.[id];
      return answer ? [{ engine, label: answerLabel(answer), confidence: answerConfidence(answer), model }] : [];
    });
    recordAgreements(feature, rows, liveEngine);
  }
}

/** Comparable across engines: a yes/no at 0.5, a choice by id, a score by level. */
const answerLabel = (answer: DecisionAnswer): string =>
  answer.type === 'noul'
    ? String(answer.noul >= 0.5)
    : answer.type === 'choice'
      ? answer.choice
      : answer.type === 'value'
        ? String(answer.value)
        : String(answer.level);

const comparedAnswer = <T>(task: DecisionTask<T>, run: EngineRun<T>): ComparedAnswer => ({
  engine: run.engine,
  label: run.answer !== null ? task.toLabel(run.answer) : null,
  confidence: run.confidence,
  model: run.model,
});

/**
 * One count per pair of engines that both answered, named in engine order: xor_jev, xor_llm,
 * jev_llm. Pairs with the live engine carry how sure it was; pairs with the LLM, which model it
 * was, since a desk's own LLM and the shared one both count as llm.
 */
function recordAgreements(
  feature: DecisionFeature,
  answers: ComparedAnswer[],
  liveEngine: DecisionEngine | undefined
): void {
  const answered = new Map(answers.filter((a) => a.label !== null).map((a) => [a.engine, a]));
  const live = liveEngine ? answered.get(liveEngine) : undefined;
  const liveConfidence = live ? confidenceBucket(live.confidence) : undefined;
  const llmModel = answered.get('llm')?.model;
  DECISION_ENGINES.forEach((first, i) => {
    for (const second of DECISION_ENGINES.slice(i + 1)) {
      const a = answered.get(first);
      const b = answered.get(second);
      if (!a || !b) continue;
      const withLive = first === liveEngine || second === liveEngine;
      recordAgreement(feature, `${first}_${second}`, a.label === b.label, {
        liveConfidence: withLive ? liveConfidence : undefined,
        llmModel: second === 'llm' ? llmModel : undefined,
      });
    }
  });
}
