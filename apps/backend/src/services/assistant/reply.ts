import {
  starterActions,
  type ActionCatalog,
  type ChoiceOption,
  type Display,
  type EngineNote,
  type EngineStep,
} from '@xyne/shared/assistant';
import type { SentenceKind } from './intent';
import type { OpenQuestion } from './session';

/**
 * Everything the assistant says, in one place. Turns an engine step into words, buttons, or
 * a preview, and remembers which question is now on screen.
 */

export interface Reply {
  say: string;
  display?: Display;
  question: OpenQuestion | null;
  expectsReply: boolean;
  tone?: 'error';
  /** A question for Xyne AI: the dashboard offers to ask it. */
  handoff?: { to: 'ask_ai'; text: string };
}

/** Words for an engine step. A `run` step is answered by the plan, not by words. */
export function replyForStep(
  step: Exclude<EngineStep, { kind: 'run' }>,
  notes: EngineNote[]
): Reply {
  const lead = leadIn(notes);
  switch (step.kind) {
    case 'ask': {
      const options = step.options ?? [];
      const prompt = step.declined
        ? `No problem. ${step.prompt} Or say “cancel” to stop.`
        : step.prompt;
      return {
        say: lead + prompt,
        ...(options.length ? { display: { kind: 'choices', prompt: step.prompt, options } } : {}),
        question: { kind: 'detail', field: step.field, options },
        expectsReply: true,
      };
    }
    case 'confirm':
      return {
        say: `${lead}${step.summary}?`,
        display: {
          kind: 'preview',
          summary: step.summary,
          confirmLabel: 'Yes',
          cancelLabel: 'Cancel',
        },
        question: { kind: 'preview' },
        expectsReply: true,
      };
    case 'cancelled':
      return { say: 'Okay, I’ve cancelled that.', question: null, expectsReply: false };
    case 'idle':
      return { say: IDLE_REPLIES[step.reason], question: null, expectsReply: false };
  }
}

/** "Did you mean … or …?" when two or three actions are equally likely. */
export function replyForActionChoice(
  actions: string[],
  catalog: ActionCatalog,
  text: string
): Reply {
  const options = actionOptions(catalog, actions);
  const prompt = `Did you mean to ${options.map((option) => lowerFirst(option.label)).join(', or ')}?`;
  return {
    say: prompt,
    display: { kind: 'choices', prompt, options },
    question: { kind: 'action', options, text },
    expectsReply: true,
  };
}

/**
 * Replies to sentences that are not requests for an action. `{actions}` lists what the
 * assistant can do, from the catalog, and `offersActions` adds buttons that start them.
 */
const KIND_REPLIES: Record<
  Exclude<SentenceKind, 'action' | 'question'>,
  { say: string; offersActions: boolean }
> = {
  help: { say: 'I can {actions}. Tap one, or just tell me what you need.', offersActions: true },
  greeting: { say: 'Hi! What can I do for you?', offersActions: true },
  thanks: { say: 'You’re welcome.', offersActions: false },
  unclear: { say: 'I didn’t catch that. What would you like to do?', offersActions: true },
};

/** A friendly reply to help, a greeting, thanks, or something unclear. */
export function replyForKind(kind: keyof typeof KIND_REPLIES, catalog: ActionCatalog): Reply {
  const { say: template, offersActions } = KIND_REPLIES[kind];
  const options = starterOptions(catalog);
  const say = template.replace('{actions}', listOfActions(options));
  if (!offersActions) return { say, question: null, expectsReply: false };
  return {
    say,
    display: { kind: 'choices', prompt: say, options },
    question: { kind: 'action', options, text: '' },
    expectsReply: true,
  };
}

/** A question to answer rather than a task: Xyne AI answers those, so offer to ask it. */
export function replyForQuestion(text: string): Reply {
  return {
    say: 'That’s one for Xyne AI. Want me to ask it?',
    question: null,
    expectsReply: false,
    handoff: { to: 'ask_ai', text },
  };
}

/**
 * Help or a question in the middle of a request: answer it, then ask the open question again,
 * so the request is not lost ("I can … Now, what should I name the channel?").
 */
export function replyForAside(
  kind: 'help' | 'question',
  text: string,
  catalog: ActionCatalog,
  openQuestion: Reply
): Reply {
  const aside =
    kind === 'help'
      ? `I can ${listOfActions(starterOptions(catalog))}.`
      : 'That’s one for Xyne AI.';
  return {
    ...openQuestion,
    say: `${aside} Now, ${lowerFirst(openQuestion.say)}`,
    ...(kind === 'question' ? { handoff: { to: 'ask_ai' as const, text } } : {}),
  };
}

/**
 * When nothing fits: offer the actions closest to what was said, as buttons that start them.
 * `suggested` is ordered most likely first, so it stays relevant however many actions exist.
 */
export function replyForNothingFits(catalog: ActionCatalog, suggested: readonly string[]): Reply {
  const options = actionOptions(catalog, suggested);
  const say = `I can’t do that yet. I can ${listOfActions(options)}.`;
  return {
    say,
    display: { kind: 'choices', prompt: say, options },
    question: { kind: 'action', options, text: '' },
    expectsReply: true,
  };
}

export function replyForError(message: string): Reply {
  return { say: message, question: null, expectsReply: false, tone: 'error' };
}

const IDLE_REPLIES: Record<Extract<EngineStep, { kind: 'idle' }>['reason'], string> = {
  'nothing-pending': 'There’s nothing waiting for an answer right now.',
  'nothing-parked': 'There’s nothing on hold to continue.',
  'unknown-action': 'I can’t do that yet.',
};

/** What happened to other requests this turn, said before the question. */
function leadIn(notes: EngineNote[]): string {
  return notes
    .map((note) => {
      if (note.kind === 'parked') return 'I’ve put your earlier request on hold. ';
      if (note.kind === 'resumed') return 'Back to where we were. ';
      return '';
    })
    .join('');
}

/** The reminder said after a finished action, when another request is still on hold. */
export function reminderFor(notes: EngineNote[]): string | undefined {
  const waiting = notes.find((note) => note.kind === 'still-parked');
  return waiting && waiting.kind === 'still-parked'
    ? `You also have a request on hold: ${lowerFirst(waiting.summary)}. Say “continue” to pick it up.`
    : undefined;
}

/** Buttons that start these actions, labelled with their titles. */
function actionOptions(catalog: ActionCatalog, ids: readonly string[]): ChoiceOption[] {
  return ids.flatMap((id) => {
    const action = catalog.get(id);
    return action ? [{ id, label: action.title }] : [];
  });
}

function starterOptions(catalog: ActionCatalog): ChoiceOption[] {
  return starterActions(catalog).map((action) => ({ id: action.id, label: action.title }));
}

/** "create a channel, send a direct message, or post in a channel". */
function listOfActions(options: readonly ChoiceOption[]): string {
  const items = options.map((option) => lowerFirst(option.label));
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')}, or ${items.at(-1)}`;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}
