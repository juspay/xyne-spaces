import {
  chooseWithJev,
  type NavigateChooseRequest,
} from '../../../services/assistantNavigateService';
import { DESTINATIONS, ITEM_TYPE_WORDS, type Destination, type Opener } from './destinations';
import { logChoose } from './navigatorDebug';
import type { NavigatorItem, NavigatorItems } from './useNavigatorItems';

// Jev reads at most this many items of one kind; the rest are cut by a cheap name match first.
const SHORTLIST_SIZE = 60;

export type Resolution =
  /** Go straight to `path` (if any), then run `opener` (if any). */
  | {
      kind: 'open';
      path: string;
      label: string;
      confidence: number;
      opener?: Opener;
      /** Go to `path`, then let the click agent press the button that opens the form. */
      finishByClicking?: true;
      note?: string;
    }
  /** The goal is a kind of item (a canvas…) but none of the user's matched: open the list. */
  | { kind: 'itemNotFound'; destination: Destination; itemType: string }
  /** Not a known destination: leave it to the click-by-click agent. */
  | { kind: 'fallback'; reason: string };

// Words that say where or how to go, not which item: dropped before matching names.
const FILLER = new Set(
  (
    'take me to the a an open go goto show find bring navigate my our with named called name ' +
    'whose is please page of for in on at up dm dms direct message messages chat conversation ' +
    'canvas canvases doc docs document channel channels group agent agents bot'
  ).split(' '),
);

const words = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** How well `label` matches the name-like words of the goal; 0 for no overlap. */
const nameScore = (goalWords: readonly string[], label: string): number => {
  const labelWords = words(label);
  let score = 0;
  for (const g of goalWords) {
    let best = 0;
    for (const l of labelWords) {
      if (l === g) best = Math.max(best, 3);
      // "oms" ~ "om", "pri" ~ "priya"
      else if (Math.min(l.length, g.length) >= 2 && (l.startsWith(g) || g.startsWith(l))) {
        best = Math.max(best, 2);
      } else if (g.length >= 3 && l.includes(g)) best = Math.max(best, 1);
    }
    score += best;
  }
  return score;
};

/** The items most likely meant, best name match first, ties kept in their original order. */
export const shortlist = (goal: string, items: readonly NavigatorItem[]): NavigatorItem[] => {
  const goalWords = words(goal).filter(w => !FILLER.has(w));
  if (goalWords.length === 0) return items.slice(0, SHORTLIST_SIZE);
  return items
    .map((item, index) => ({ item, index, score: nameScore(goalWords, item.label) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, SHORTLIST_SIZE)
    .map(({ item }) => item);
};

/**
 * Works out where the goal leads without touching the screen: one Jev pick among the app's
 * destinations and, for a specific item, one more among the user's items of that kind.
 */
export async function resolveGoal(
  goal: string,
  items: NavigatorItems,
  signal: AbortSignal,
): Promise<Resolution> {
  const destinationRequest: NavigateChooseRequest = {
    goal,
    kind: 'destination',
    // No current page: it pulls Jev toward wherever the user already is ("show my mentions"
    // from Bookmarks picked Bookmarks).
    options: DESTINATIONS.map(d => ({ id: d.id, description: `${d.title}: ${d.description}` })),
  };
  let started = performance.now();
  const picked = await chooseWithJev(destinationRequest, signal);
  logChoose('destination', destinationRequest, picked, performance.now() - started);

  if (picked.status === 'unavailable') {
    return {
      kind: 'fallback',
      reason: picked.debug?.unavailableReason ?? picked.error ?? 'Jev unavailable',
    };
  }
  if (picked.status === 'none') return { kind: 'fallback', reason: 'no known destination fits' };
  if (picked.status === 'unsure') {
    return {
      kind: 'fallback',
      reason: `not sure it meant ${picked.id} (${picked.confidence.toFixed(2)})`,
    };
  }

  const destination = DESTINATIONS.find(d => d.id === picked.id);
  if (!destination) return { kind: 'fallback', reason: `unknown destination ${picked.id}` };
  if (destination.creates && picked.confidence < destination.creates.minConfidence) {
    // Not sure enough to create something: show where it is made instead.
    const { fallback } = destination.creates;
    return {
      kind: 'open',
      path: fallback.path,
      label: fallback.title,
      confidence: picked.confidence,
      note: fallback.note,
    };
  }
  if (!destination.item) {
    return {
      kind: 'open',
      path: destination.path,
      label: destination.title,
      confidence: picked.confidence,
      ...(destination.open ? { opener: destination.open } : {}),
      ...(destination.finishByClicking ? { finishByClicking: true as const } : {}),
      ...(destination.note ? { note: destination.note } : {}),
    };
  }

  const itemType = ITEM_TYPE_WORDS[destination.item];
  const candidates = shortlist(goal, items[destination.item]);
  if (candidates.length === 0) return { kind: 'itemNotFound', destination, itemType };

  const itemRequest: NavigateChooseRequest = {
    goal,
    kind: 'item',
    itemType,
    options: candidates.map((item, index) => ({
      id: `i${index}`,
      description: (item.detail ? `${item.label} — ${item.detail}` : item.label).slice(0, 300),
    })),
  };
  started = performance.now();
  const item = await chooseWithJev(itemRequest, signal);
  logChoose(`item (${destination.item})`, itemRequest, item, performance.now() - started);

  if (item.status !== 'chosen') return { kind: 'itemNotFound', destination, itemType };
  const chosen = candidates[Number(item.id.slice(1))];
  if (!chosen) return { kind: 'itemNotFound', destination, itemType };
  return {
    kind: 'open',
    path: chosen.path,
    label: chosen.label,
    confidence: item.confidence,
    ...(destination.note ? { note: destination.note } : {}),
  };
}
