import type {
  ActionCatalog,
  ChoiceOption,
  Display,
  EngineNote,
  EngineStep,
} from '@xyne/shared/assistant';
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
}

/** Words for an engine step. A `run` step is answered by the plan, not by words. */
export function replyForStep(step: Exclude<EngineStep, { kind: 'run' }>, notes: EngineNote[]): Reply {
  const lead = leadIn(notes);
  switch (step.kind) {
    case 'ask': {
      const options = step.options ?? [];
      return {
        say: lead + step.prompt,
        ...(options.length ? { display: { kind: 'choices', prompt: step.prompt, options } } : {}),
        question: { kind: 'detail', field: step.field, options },
        expectsReply: true,
      };
    }
    case 'confirm':
      return {
        say: `${lead}${step.summary}?`,
        display: { kind: 'preview', summary: step.summary, confirmLabel: 'Yes', cancelLabel: 'Cancel' },
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
export function replyForActionChoice(actions: string[], catalog: ActionCatalog, text: string): Reply {
  const options: ChoiceOption[] = actions.flatMap(id => {
    const action = catalog.get(id);
    return action ? [{ id, label: action.title }] : [];
  });
  const prompt = `Did you mean to ${options.map(option => lowerFirst(option.label)).join(', or ')}?`;
  return {
    say: prompt,
    display: { kind: 'choices', prompt, options },
    question: { kind: 'action', options, text },
    expectsReply: true,
  };
}

/** When nothing the assistant can do fits: say what it can do instead. */
export function replyForNothingFits(catalog: ActionCatalog): Reply {
  const titles = [...catalog.values()].map(action => lowerFirst(action.title));
  return {
    say: `I can’t do that yet. I can ${listWithOr(titles)}.`,
    question: null,
    expectsReply: false,
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
    .map(note => {
      if (note.kind === 'parked') return 'I’ve put your earlier request on hold. ';
      if (note.kind === 'resumed') return 'Back to where we were. ';
      return '';
    })
    .join('');
}

/** The reminder said after a finished action, when another request is still on hold. */
export function reminderFor(notes: EngineNote[]): string | undefined {
  const waiting = notes.find(note => note.kind === 'still-parked');
  return waiting && waiting.kind === 'still-parked'
    ? `You also have a request on hold: ${lowerFirst(waiting.summary)}. Say “continue” to pick it up.`
    : undefined;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function listWithOr(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')}, or ${items.at(-1)}`;
}
