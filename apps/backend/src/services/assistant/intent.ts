import {
  intentCriteria,
  renderTemplate,
  summarizeDraft,
  type ActionCatalog,
  type ActionDefinition,
  type Draft,
  type EntityKind,
} from '@xyne/shared/assistant';
import type { JevAnswer, JevQuestion, JevState } from '@/services/queryIntent/jevClient';
import { readingFor, type FieldReading, type FieldWords } from './fields';

/**
 * Understanding a sentence in one Jev request, asked all at once:
 * - `kind`: what kind of sentence it is,
 * - `action`: which action it asks for, or none,
 * - `continues`: whether it answers the request in progress, when there is one,
 * - and for every action, which words of the sentence are each of its details.
 * The state carries the sentence, the channel on screen, and the question the assistant just
 * asked, so every answer is read in context. Code then uses the answers of the chosen action.
 */

export interface SentenceContext {
  /** The request in progress, with the question on screen. */
  draft: Draft | null;
  /** The name of the channel open on screen, which "here" means. */
  screen?: string;
  /** The kinds of record open on screen; a field can offer the one that is (see `onScreen`). */
  onScreen?: ReadonlySet<EntityKind>;
}

export interface RankedAction {
  action: string;
  probability: number;
}

export type IntentDecision =
  | { kind: 'act'; action: string }
  /** Too close to call: "Did you mean … or …?". */
  | { kind: 'ask'; actions: string[] }
  | { kind: 'none' };

export interface Understanding {
  kind: SentenceKind;
  ranked: RankedAction[];
  decision: IntentDecision;
  /** P(the sentence answers the request in progress), when there is one. */
  continues: number | null;
  /** The words for each detail of `action`, or null when this request did not ask. */
  words(action: ActionDefinition): FieldWords | null;
}

const SENTENCE_KINDS = {
  action:
    'Asks the assistant to do something in the workspace, such as sending a message or creating a channel, in any wording ("can you help me …", "I want …", "let’s …").',
  help: 'Asks what the assistant can do or how to use it ("what can you do?", "help", "how does this work?").',
  greeting: 'A greeting or small talk ("hi", "hello", "how are you?").',
  thanks: 'Thanks or a goodbye ("thanks", "that’s all", "bye").',
  question:
    'Wants an answer or an explanation, about work or anything else ("what did we decide about the launch?"), rather than something in the workspace to find, open, or do.',
  unclear: 'Cut off, noise, or makes no sense on its own.',
} as const;

export type SentenceKind = keyof typeof SENTENCE_KINDS;

const NONE = 'none';
/** Below this, an action is not a real candidate. */
const MIN_PROBABILITY = 0.2;
/** Act without asking when the best action is this likely … */
const ACT_PROBABILITY = 0.5;
/** … and this far ahead of the next one. */
const ACT_LEAD = 0.2;
/** Past this many detail questions, only the chosen action's details are asked, afterwards. */
const MAX_FIELD_QUESTIONS = 40;

const CONTINUES: JevQuestion = {
  type: 'noul',
  instructions:
    '`inProgress` is a request the assistant is still working on, and `inProgress.question` is what it just asked. Does `request` answer that question, or correct or add to that request, rather than start a new one?',
  criteria: {
    true: 'It answers or adjusts the request in progress: "call it ABC", "private", "also add Priya", "actually make it Daniel Park", "the one with Meera", or any words to send when `inProgress.question` asks what to say ("the build is green").',
    false:
      'It is a complete request of its own, even for the same kind of action: if a message to Arjun is waiting for its text and `request` says "tell Meera the doc is ready", start a new message to Meera with "the doc is ready"; also "create a channel called Ops" starts a new request.',
  },
};

export interface SentenceReading {
  state: JevState;
  questions: Record<string, JevQuestion>;
  read(answers: Record<string, JevAnswer>): Understanding;
}

export function readSentence(
  text: string,
  catalog: ActionCatalog,
  context: SentenceContext
): SentenceReading {
  const actions = [...catalog.values()];
  const inProgress = context.draft ? catalog.get(context.draft.action) : undefined;
  const onScreen = context.onScreen ?? new Set<EntityKind>();
  // Jev uses an open thread to understand contextual replies.
  const threadOpen = onScreen.has('thread');
  const fields = fieldReadings(text, actions, inProgress, onScreen);
  const questions: Record<string, JevQuestion> = {
    kind: {
      type: 'choice',
      instructions: 'What kind of sentence is `request`, said to an assistant in a work chat app?',
      criteria: SENTENCE_KINDS,
    },
    action: {
      type: 'choice',
      instructions: 'Which action does `request` ask the assistant to do?',
      criteria: {
        ...Object.fromEntries(actions.map((action) => [action.id, intentCriteria(action)])),
        [NONE]:
          'None of these: a question to answer, small talk, or something the assistant cannot do.',
      },
    },
    ...(inProgress ? { continues: CONTINUES } : {}),
    ...Object.assign({}, ...[...fields.values()].map((reading) => reading.questions)),
  };
  const state = {
    request: text,
    ...(context.screen || threadOpen
      ? {
          screen: {
            ...(context.screen ? { channel: context.screen } : {}),
            ...(threadOpen ? { threadOpen: true } : {}),
          },
        }
      : {}),
    ...(context.draft && inProgress
      ? { inProgress: describeInProgress(context.draft, inProgress) }
      : {}),
  };

  return {
    state,
    questions,
    read(answers) {
      const ranked = rankActions(answers, actions);
      const { kind, continues } = answers;
      return {
        kind:
          kind?.type === 'choice' && kind.choice in SENTENCE_KINDS
            ? (kind.choice as SentenceKind)
            : 'action',
        ranked,
        decision: decideIntent(ranked),
        continues: continues?.type === 'noul' ? continues.noul : null,
        words: (action) => fields.get(action.id)?.read(answers) ?? null,
      };
    },
  };
}

/**
 * The detail questions: every action's while they fit in one request, so the chosen action's
 * details come back with it. Past that, only the request in progress is read now.
 */
function fieldReadings(
  text: string,
  actions: readonly ActionDefinition[],
  inProgress: ActionDefinition | undefined,
  onScreen: ReadonlySet<EntityKind>
): Map<string, FieldReading> {
  const count = actions.reduce((sum, action) => sum + Object.keys(action.fields).length, 0);
  const asked = count <= MAX_FIELD_QUESTIONS ? actions : inProgress ? [inProgress] : [];
  return new Map(
    asked.map((action) => {
      const answers = action === inProgress ? '`request` answers `inProgress` or ' : '`request` ';
      const premise = `If ${answers}asks to ${lowerFirst(action.title)}: `;
      const key = (field: string): string => `${action.id}.${field}`;
      return [action.id, readingFor(action, text, { key, premise, onScreen })];
    })
  );
}

/** What Jev needs to read an answer: the request so far, and the question on screen. */
function describeInProgress(draft: Draft, action: ActionDefinition): Record<string, unknown> {
  const [name] = draft.open;
  const asked = name?.field ?? (draft.awaiting?.kind === 'field' ? draft.awaiting.field : '');
  const field = action.fields[asked];
  const ask = field && renderTemplate(field.ask, draft.values);
  const question = !field
    ? undefined
    : !name
      ? ask
      : name.options.length
        ? (field.choose ?? field.ask).replace('{mention}', name.said)
        : `I couldn't find “${name.said}”. ${ask}`;
  const options = name?.options.map(({ label, detail }) =>
    detail ? `${label} · ${detail}` : label
  );
  return {
    request: summarizeDraft(draft, action),
    ...(name ? { openField: { field: name.field, said: name.said } } : {}),
    ...(question ? { question } : {}),
    ...(options?.length ? { options } : {}),
  };
}

/** Every action, best first, by Jev's probability that the sentence asks for it. */
export function rankActions(
  answers: Record<string, JevAnswer>,
  actions: readonly ActionDefinition[]
): RankedAction[] {
  const answer = answers.action;
  if (answer?.type !== 'choice') return [];
  return actions
    .map((action) => ({ action: action.id, probability: answer.probabilities[action.id] ?? 0 }))
    .sort((left, right) => right.probability - left.probability);
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
  return close.length > 1 ? { kind: 'ask', actions: close } : { kind: 'none' };
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}
