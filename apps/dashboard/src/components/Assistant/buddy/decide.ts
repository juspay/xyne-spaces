import { MIN_PROBABILITY } from './constants';

const NONE_ID = 'none';

export type JevResult =
  | { route: 'actions'; actionIds: string[]; chosen?: string; probability?: number }
  | { route: 'ask_ai'; chosen?: string; probability?: number }
  | { route: 'unavailable' };

export type Decision =
  | { kind: 'act'; id: string; why: string }
  | { kind: 'ask'; ids: [string, string]; why: string }
  | { kind: 'ask_ai'; why: string };

/**
 * Acts on Jev's top pick at MIN_PROBABILITY or above. Below it, when Jev is sure the user wants
 * an action but split its vote, asks between its two best; otherwise Ask AI answers.
 */
export function decide(result: JevResult, nameOf = (id: string): string => id): Decision {
  if (result.route === 'unavailable') return { kind: 'ask_ai', why: 'Jev unavailable' };
  const { chosen, probability = 0 } = result;
  const at = probability.toFixed(2);
  if (chosen === undefined || chosen === NONE_ID) {
    return { kind: 'ask_ai', why: `Jev picked ${chosen ?? 'nothing'} at ${at}` };
  }
  if (probability >= MIN_PROBABILITY) {
    return { kind: 'act', id: chosen, why: `Jev: "${nameOf(chosen)}" at ${at}` };
  }
  const [a, b] = result.route === 'actions' ? result.actionIds : [];
  if (a !== undefined && b !== undefined) {
    return { kind: 'ask', ids: [a, b], why: `Jev split between "${nameOf(a)}" and "${nameOf(b)}"` };
  }
  return { kind: 'ask_ai', why: `Jev leaned to "${nameOf(chosen)}" at ${at}` };
}
