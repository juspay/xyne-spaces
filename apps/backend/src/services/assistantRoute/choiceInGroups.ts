import type { DecisionAnswer } from '@/services/decision/types';

export type ChoiceAnswer = Extract<DecisionAnswer, { type: 'choice' }>;

/** One option: its id and what the engine reads about it. */
export type ChoiceOption = readonly [id: string, description: string];

/** Puts one choice question to the engine; null when it could not answer. */
export type AskChoice = (
  criteria: Record<string, string>,
  timeoutMs: number
) => Promise<ChoiceAnswer | null>;

/** The engines take 2..64 options in one choice question, `none` included. */
export const MAX_CHOICE_OPTIONS = 64;
const PER_GROUP = MAX_CHOICE_OPTIONS - 1;
/** From each group, up to this many of its likeliest picks go to the final round… */
const FINALISTS_PER_GROUP = 2;
/** …when this likely; a group's own choice always goes. */
const FINALIST_FLOOR = 0.1;
/** The final round keeps at least this long, however long the groups took. */
const MIN_FINAL_MS = 1_000;

export const groupsOf = <T>(items: readonly T[], size: number): T[][] => {
  const groups: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    groups.push(items.slice(start, start + size));
  }
  return groups;
};

/** A group's picks for the final round: its choice, and what came close to it. */
const finalistIds = (answer: ChoiceAnswer, noneId: string): string[] => {
  const close = Object.entries(answer.probabilities)
    .filter(([id, p]) => id !== noneId && p >= FINALIST_FLOOR)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
  const own = answer.choice === noneId ? [] : [answer.choice];
  return [...new Set([...own, ...close])].slice(0, FINALISTS_PER_GROUP);
};

/**
 * Asks which option fits, however many there are. Up to MAX_CHOICE_OPTIONS it is one question.
 * Past it, the options go in groups (in their order) asked side by side, then each group's picks
 * in one final question, whose answer is the answer: so its probabilities mean what one question's
 * would. Every group answering `none` is `none` (at the least sure group's p(none)); a group that
 * failed leaves that open, so it is no answer. A failed final round falls back to the surest group.
 * Half the time goes to the groups, the rest to the final round.
 */
export async function chooseInGroups(
  options: readonly ChoiceOption[],
  none: ChoiceOption,
  ask: AskChoice,
  timeoutMs: number
): Promise<{ answer: ChoiceAnswer | null; groups: number }> {
  const [noneId] = none;
  const criteriaOf = (picked: readonly ChoiceOption[]): Record<string, string> =>
    Object.fromEntries([...picked, none]);
  if (options.length < MAX_CHOICE_OPTIONS) {
    return { answer: await ask(criteriaOf(options), timeoutMs), groups: 1 };
  }

  const started = Date.now();
  const groups = groupsOf(options, PER_GROUP);
  const answers = await Promise.all(
    groups.map((group) => ask(criteriaOf(group), Math.round(timeoutMs / 2)))
  );
  const answered = answers.filter((answer): answer is ChoiceAnswer => answer !== null);
  if (answered.length === 0) return { answer: null, groups: groups.length };

  const picked = new Set(answered.flatMap((answer) => finalistIds(answer, noneId)));
  const finalists = options.filter(([id]) => picked.has(id));
  if (finalists.length === 0) {
    if (answered.length < groups.length) return { answer: null, groups: groups.length };
    const p = Math.min(...answered.map((answer) => answer.probabilities[noneId] ?? 0));
    return {
      answer: { type: 'choice', choice: noneId, probabilities: { [noneId]: p }, confidence: p },
      groups: groups.length,
    };
  }

  const left = Math.max(MIN_FINAL_MS, timeoutMs - (Date.now() - started));
  const final = await ask(criteriaOf(finalists), left);
  if (final) return { answer: final, groups: groups.length };
  const surest = answered
    .filter((answer) => answer.choice !== noneId)
    .sort((a, b) => (b.probabilities[b.choice] ?? 0) - (a.probabilities[a.choice] ?? 0))[0];
  return { answer: surest ?? null, groups: groups.length };
}
