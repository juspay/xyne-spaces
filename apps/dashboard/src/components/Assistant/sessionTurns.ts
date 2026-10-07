import { fillTemplate, type ActionDefinition } from './actions/action';
import { assistantSession } from './assistantSession';
import { droppedText } from './engine/chain';
import { LIKELY_REPLIES, openQuestion, retryable, type EngineState } from './engine/dialogue';
import type { InterpretContext } from './engine/interpret';
import { withShownList } from './engine/results';
import type { RunResult } from './engine/runner';
import { onScreen, snapshotOf } from './onScreen';
import type { TaskOutcome } from './tasks';
import { exchange, say, withoutCards, type AssistantCardData, type AssistantTurn } from './turns';

// These work on the store, not a component, so a run that outlives its page still posts.

export const newId = (): string => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const sentence = (text: string): string => (/[.!?…]$/.test(text) ? text : `${text}.`);

// What was done, without the next step it goes on to offer.
const firstSentence = (text: string): string => /^.*?[.!?…](?=\s|$)/.exec(text)?.[0] ?? text;

export const setTurns = (change: (turns: AssistantTurn[]) => AssistantTurn[]): void =>
  assistantSession.update({ turns: change(assistantSession.get().turns) });

/** Posts the exchange that shows `chosen`, and returns its reply. */
export const append = (
  userText: string,
  chosen: readonly ActionDefinition[],
  how = false,
): string => {
  const pair = exchange(userText, chosen, new Date(), newId, how);
  setTurns(prev => [...prev, ...pair]);
  return pair[1].text;
};

/** Posts a reply, after what the user said if anything, in place of any card on screen. */
export const post = (
  said: string | null,
  text: string,
  card?: AssistantCardData,
  pills?: ActionDefinition[],
): void =>
  setTurns(prev => [
    ...withoutCards(prev),
    ...(said ? [say('user', said, newId)] : []),
    { ...say('assistant', text, newId, card), ...(pills && { actions: pills }) },
  ]);

/** Drops the request under way, and its card. */
export const endDialogue = (): void => {
  const { turns } = assistantSession.get();
  assistantSession.update({
    dialogue: null,
    turns: turns.some(turn => turn.card) ? withoutCards(turns) : turns,
  });
};

/** What the user may be answering; a list the page shows anew is the one picked from. */
export const readContext = (): InterpretContext => {
  const { dialogue, aside, unsure } = assistantSession.get();
  const shown = onScreen.list.get();
  const list = shown?.ready ? snapshotOf(shown) : null;
  return {
    dialogue: dialogue && list ? withShownList(dialogue, list) : dialogue,
    aside,
    unsure,
    list,
  };
};

/** Drops the "did you mean" card, buttons and all, so a tap on it is never left dead. */
export const closeUnsure = (): void => {
  const { unsure, turns } = assistantSession.get();
  if (unsure) assistantSession.update({ unsure: null, turns: withoutCards(turns) });
};

const failureOf = (
  result: Extract<RunResult, { ok: false }>,
  state: EngineState,
  current: boolean,
): { text: string; dialogue: EngineState | null } => {
  const ask = result.field ? state.action.fields[result.field]?.ask : undefined;
  if (result.field && ask) {
    return {
      text: `${sentence(result.error)} ${ask}`,
      dialogue: { ...state, phase: { kind: 'collecting', field: result.field } },
    };
  }
  // A refusal would be refused again, so only a passing failure is offered again with "yes".
  const retry = current && !result.refused ? ' Say yes to try again.' : '';
  return { text: `${sentence(result.error)}${retry}`, dialogue: retryable(state) };
};

/**
 * What a run came to, said to the user, and the dialogue it leaves; `told` is its task's.
 * `chained`: a step of the same sentence follows, which is what is offered next.
 */
export const outcomeOf = (
  result: RunResult,
  state: EngineState,
  current: boolean,
  told?: TaskOutcome | void,
  chained = false,
): { text: string; dialogue: EngineState | null } => {
  if (!result.ok) return failureOf(result, state, current);
  const done = told?.done ?? fillTemplate(state.action.done ?? 'Done.', state.values);
  if (chained) return { text: sentence(firstSentence(done)), dialogue: null };
  return { text: told?.next ? `${sentence(done)} ${told.next}` : done, dialogue: null };
};

/** Lets go of the steps still to come; what was let go of, to say once, or ''. */
export const dropQueue = (): string => {
  const { queued } = assistantSession.get();
  assistantSession.update({ queued: [] });
  return droppedText(queued);
};

/** What voice mode synthesizes ahead of time: the open question, and the likeliest replies. */
export const warmPhrases = (): readonly string[] => {
  const { dialogue } = assistantSession.get();
  const question = dialogue && openQuestion(dialogue);
  return question ? [question.prompt, ...LIKELY_REPLIES] : LIKELY_REPLIES;
};

/** The open question put again after a detour; null when none is open. */
export const resumePrompt = (): string | null => {
  const { dialogue } = assistantSession.get();
  const question = dialogue && openQuestion(dialogue);
  return dialogue && question ? `Back to ${dialogue.action.title}: ${question.prompt}` : null;
};
