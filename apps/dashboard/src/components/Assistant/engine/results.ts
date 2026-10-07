import type {
  Advance,
  DialogueEvent,
  EngineState,
  ListItem,
  Phase,
  ShownResults,
  Step,
} from './dialogue';
import { clip, listOf } from './text';

// Fixed, as Jev reads it and voice warms it.
export const RESULTS_PROMPT =
  'Can you tell me more, like a channel, a person or when? Or pick one from the list.';
const REFINE_PROMPT = 'Tell me more, like a channel, a person or when.';
const NOTHING_NARROWED = 'Nothing matches that. Want me to widen the search back, or tell me more?';
const ALL_SHOWN = "That's all of them. Pick one, or tell me more.";

const CARD_ITEMS = 5;
const SPOKEN_ITEMS = 3;

type ResultsPhase = Extract<Phase, { kind: 'results' }>;

/** How an item is said aloud: who or what, and where, never a message's words. */
export const spokenItem = ({ label, group }: ListItem): string =>
  group ? `${label} in ${group}` : label;

// The items are one page of the results, so this says "mostly", never a count.
const mostlyIn = (items: readonly ListItem[]): string => {
  const counts = new Map<string, number>();
  items.forEach(({ group }) => group && counts.set(group, (counts.get(group) ?? 0) + 1));
  const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 2);
  return top.length > 0 ? `, mostly in ${top.map(([group]) => group).join(' and ')}` : '';
};

/** An item of the list on screen, opened. */
export const opening = (item: ListItem): Step => ({
  kind: 'results',
  prompt: `Opened ${spokenItem(item)}.`,
  options: [],
  open: item,
});

const showing = (state: EngineState, list: ShownResults, start: number): EngineState => ({
  ...state,
  phase: { kind: 'results', list, start },
});

const nothingFound = (state: EngineState): string => {
  if (state.earlier?.length) return NOTHING_NARROWED;
  const topic = state.values['topic']?.trim();
  const what = topic ? ` for “${clip(topic)}”` : '';
  return `Nothing${what}. Try other words, a person, or when it was.`;
};

// The card holds the items from `start` in on-screen order, so "the third one" is the third there.
function listed(state: EngineState, list: ShownResults, start: number, open: boolean): Advance {
  const { items } = list;
  const count = Math.max(list.total, items.length);
  const page = items.slice(start, start + CARD_ITEMS);
  const said = (prompt: string, options: ListItem[] = page, item?: ListItem): Advance => ({
    state: showing(state, list, start),
    step: { kind: 'results', prompt, options, ...(item && { open: item }) },
  });
  const [first] = items;
  if (!first) return said(nothingFound(state));
  if (count === 1) {
    return open
      ? said(`One match: ${spokenItem(first)}. It's open.`, [], first)
      : said(`That was the only match: ${spokenItem(first)}. Tell me more to search again.`, []);
  }
  const names = page.slice(0, SPOKEN_ITEMS).map(spokenItem);
  if (count <= CARD_ITEMS) {
    return said(
      page.length > SPOKEN_ITEMS
        ? `I found ${count}. The first three are ${names.join(', ')}. Which one?`
        : `I found ${count}: ${listOf(names)}. Which one?`,
    );
  }
  if (start > 0) return said(`Next: ${listOf(names)}. Which one?`);
  return said(`I found ${count}${mostlyIn(items)}. ${RESULTS_PROMPT}`);
}

/** The dialogue picking from the newer list on screen, after the user searched again by hand. */
export function withShownList(state: EngineState, list: ShownResults | null): EngineState {
  if (state.phase.kind !== 'results' || !list || list.version === state.phase.list.version) {
    return state;
  }
  return showing(state, list, 0);
}

/** The reply once a run has found a list; the dialogue then waits on the user's pick. */
export const afterList = (state: EngineState, list: ShownResults): Advance =>
  listed(state, list, 0, true);

const nextPage = (state: EngineState, { list, start }: ResultsPhase): Advance =>
  start + CARD_ITEMS < list.items.length
    ? listed(state, list, start + CARD_ITEMS, false)
    : {
        state,
        step: {
          kind: 'results',
          prompt: ALL_SHOWN,
          options: list.items.slice(start, start + CARD_ITEMS),
        },
      };

// With no narrowing to undo, the question is put again.
function back(state: EngineState, again: () => Advance): Advance {
  const earlier = state.earlier ?? [];
  const previous = earlier.at(-1);
  if (!previous) return again();
  return {
    state: {
      ...state,
      ...previous,
      unsettled: {},
      earlier: earlier.slice(0, -1),
      phase: { kind: 'submitting' },
    },
    step: { kind: 'run' },
  };
}

/** Any event but more words for the search, while a list is on screen; only a pick opens one. */
export function inResults(state: EngineState, phase: ResultsPhase, event: DialogueEvent): Advance {
  const again = (): Advance => listed(state, phase.list, phase.start, false);
  // "Yes" to widening back a narrowing that found nothing.
  const widening = phase.list.items.length === 0 && !!state.earlier?.length;
  switch (event.type) {
    case 'cancel':
      return { state, step: { kind: 'dismissed' } };
    case 'open':
      return { state, step: opening(event.item) };
    case 'more':
      return nextPage(state, phase);
    case 'no':
    case 'refine':
      return { state, step: { kind: 'results', prompt: REFINE_PROMPT, options: [] } };
    case 'yes':
      return widening ? back(state, again) : again();
    case 'back':
      return back(state, again);
    default:
      return again();
  }
}
