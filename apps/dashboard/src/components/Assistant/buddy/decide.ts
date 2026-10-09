import { MIN_PROBABILITY, SURE_CLICK } from './constants';

const NONE_ID = 'none';

export type JevResult =
  | { route: 'actions'; actionIds: string[]; chosen?: string; probability?: number }
  | { route: 'ask_ai'; chosen?: string; probability?: number }
  | { route: 'unavailable' };

export type Decision =
  | { kind: 'act'; id: string; why: string }
  | { kind: 'ask'; ids: string[]; why: string }
  | { kind: 'ask_ai'; why: string };

/**
 * Acts on Jev's top pick when it is `sure`. Less sure, asks whether its pick, or its two best when
 * Jev split its vote, is what was meant; under MIN_PROBABILITY, Ask AI answers.
 */
export function decide(
  result: JevResult,
  nameOf = (id: string): string => id,
  sure = SURE_CLICK,
): Decision {
  if (result.route === 'unavailable') return { kind: 'ask_ai', why: 'Jev unavailable' };
  const { chosen, probability = 0 } = result;
  const at = probability.toFixed(2);
  if (chosen === undefined || chosen === NONE_ID) {
    return { kind: 'ask_ai', why: `Jev picked ${chosen ?? 'nothing'} at ${at}` };
  }
  if (probability >= sure) {
    return { kind: 'act', id: chosen, why: `Jev: "${nameOf(chosen)}" at ${at}` };
  }
  const [a, b] = result.route === 'actions' ? result.actionIds : [];
  if (a !== undefined && b !== undefined) {
    return { kind: 'ask', ids: [a, b], why: `Jev split between "${nameOf(a)}" and "${nameOf(b)}"` };
  }
  if (probability >= MIN_PROBABILITY) {
    return { kind: 'ask', ids: [chosen], why: `Jev leaned to "${nameOf(chosen)}" at ${at}` };
  }
  return { kind: 'ask_ai', why: `Jev leaned to "${nameOf(chosen)}" at ${at}` };
}
