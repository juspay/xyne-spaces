import { intentCriteria, summarizeDraft, type ActionCatalog, type Draft } from '@xyne/shared/assistant';
import type { JevAnswer, JevQuestion, JevState } from '@/services/queryIntent/jevClient';

/**
 * Which action a sentence asks for, judged by Jev in ONE request:
 * - "which area?" (messaging, channels, …, or none of them),
 * - for every area, "which action in this area?",
 * - and, when a request is in progress, "does this sentence continue it?".
 *
 * Jev answers the questions in parallel, so more areas barely add time, while each choice
 * stays small. `rankActions` then scores every area-and-action pair.
 */

export interface IntentQuestions {
  state: JevState;
  questions: Record<string, JevQuestion>;
}

export interface RankedAction {
  action: string;
  probability: number;
}

export type IntentDecision =
  | { kind: 'act'; action: string }
  /** Too close to call: ask "Did you mean … or …?". */
  | { kind: 'ask'; actions: string[] }
  | { kind: 'none' };

const NONE = 'none';
/** Below this, the best action is not a real candidate. */
const MIN_PROBABILITY = 0.2;
/** Act without asking when the best action is this likely … */
const ACT_PROBABILITY = 0.5;
/** … and this far ahead of the next one. */
const ACT_LEAD = 0.2;

export function buildIntentQuestions(
  text: string,
  catalog: ActionCatalog,
  inProgress: Draft | null,
): IntentQuestions {
  const areaCriteria: Record<string, string> = {};
  const questions: Record<string, JevQuestion> = {};
  for (const area of catalog.areas) {
    areaCriteria[area.id] = area.description;
    const actionCriteria: Record<string, string> = {};
    for (const action of area.actions) actionCriteria[action.id] = intentCriteria(action);
    actionCriteria[NONE] = 'None of these actions.';
    questions[areaQuestionId(area.id)] = {
      type: 'choice',
      instructions: `Suppose \`request\` is about this: ${area.description} Which action does it ask for?`,
      criteria: actionCriteria,
    };
  }
  areaCriteria[NONE] =
    'None of these: a question to answer, small talk, or something the assistant cannot do.';
  questions.area = {
    type: 'choice',
    instructions: 'Which kind of task does `request` ask the assistant to do?',
    criteria: areaCriteria,
  };

  const state: Record<string, unknown> = { request: text };
  const definition = inProgress && catalog.get(inProgress.action);
  if (inProgress && definition) {
    state.inProgress = {
      request: summarizeDraft(inProgress, definition),
      ...(inProgress.asking ? { lastQuestion: definition.fields[inProgress.asking]?.ask } : {}),
    };
    questions.continues = {
      type: 'noul',
      instructions:
        '`inProgress` is a request the assistant is still working on. Is `request` about that same ' +
        'request — answering its last question, or correcting or adding one of its details?',
      criteria: {
        true: 'It answers or adjusts the request in progress: "call it ABC", "private", "also add Priya", "actually make it Daniel Park".',
        false:
          'It is a complete request of its own, even for the same kind of action: "tell Priya the build is ' +
          'green" while a message to Daniel is waiting, or "create a channel called Ops".',
      },
    };
  }
  return { state, questions };
}

/** Every area-and-action pair, scored as P(area) × P(action within area), best first. */
export function rankActions(
  answers: Record<string, JevAnswer>,
  catalog: ActionCatalog,
): RankedAction[] {
  const area = answers.area;
  if (area?.type !== 'choice') return [];
  const ranked: RankedAction[] = [];
  for (const { id, actions } of catalog.areas) {
    const inArea = answers[areaQuestionId(id)];
    if (inArea?.type !== 'choice') continue;
    const pArea = area.probabilities[id] ?? 0;
    for (const action of actions) {
      ranked.push({ action: action.id, probability: pArea * (inArea.probabilities[action.id] ?? 0) });
    }
  }
  return ranked.sort((left, right) => right.probability - left.probability);
}

/** Act on a clear winner, ask between close ones, or say none fits. */
export function decideIntent(ranked: readonly RankedAction[]): IntentDecision {
  const [best, second] = ranked;
  if (!best || best.probability < MIN_PROBABILITY) return { kind: 'none' };
  const lead = best.probability - (second?.probability ?? 0);
  if (best.probability >= ACT_PROBABILITY && lead >= ACT_LEAD) {
    return { kind: 'act', action: best.action };
  }
  const close = ranked
    .slice(0, 3)
    .filter(({ probability }) => probability >= MIN_PROBABILITY)
    .map(({ action }) => action);
  return close.length > 1 ? { kind: 'ask', actions: close } : { kind: 'act', action: best.action };
}

/** P(the sentence continues the request in progress), when one was asked about. */
export function continuesProbability(answers: Record<string, JevAnswer>): number | null {
  const answer = answers.continues;
  return answer?.type === 'noul' ? answer.noul : null;
}

function areaQuestionId(areaId: string): string {
  return `action_in_${areaId}`;
}

