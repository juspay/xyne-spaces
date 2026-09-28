import { ACTIONS, starterActions, type ChoiceOption, type Display } from '@xyne/shared/assistant';
import type { Message } from '../Chat/XyneAISidebar/utils/XyneAITypes';

/**
 * The assistant conversation as the panel shows it: chat bubbles in the Ask AI transcript,
 * and the question and buttons of the voice view.
 */

export type AssistantPhase =
  | 'idle'
  /** Asking the browser for the microphone. */
  | 'requesting'
  | 'listening'
  | 'transcribing'
  /** Waiting for the backend, or running a plan. */
  | 'thinking'
  | 'speaking';

/** A button that answers a turn. `id` goes back to the backend; `label` is shown. */
export interface Chip {
  id: string;
  label: string;
  /** Starts a request with these words, as if said, instead of answering a question. */
  text?: string;
  /** Hands this question to Xyne AI, which answers questions. */
  askAI?: string;
}

export interface AssistantTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: Date;
  tone?: 'error';
  /** The assistant asked something and waits for the answer. */
  expectsReply?: boolean;
  /** Buttons that answer this turn. Only the latest turn's buttons are live. */
  chips?: Chip[];
}

export interface StageContent {
  /** The line above the buttons. */
  prompt: string | null;
  chips: Chip[];
  /** The latest reply as text, so it is never only heard. */
  caption: { text: string; tone: 'error' | 'default' } | null;
}

const MESSAGE_ID_PREFIX = 'assistant-';

/** Ways to start, one per area. A tap says the action's title, and the assistant asks for the rest. */
export const STARTERS: Chip[] = starterActions(ACTIONS).map(action => ({
  id: `start-${action.id}`,
  label: action.title,
  text: action.title,
}));

/** The buttons for what the backend showed. A preview's buttons answer `yes` or `no`. */
export function chipsFor(display: Display | undefined): Chip[] {
  switch (display?.kind) {
    case 'choices':
      return display.options.map(chipOf);
    case 'preview':
      return [
        { id: 'yes', label: display.confirmLabel },
        { id: 'no', label: display.cancelLabel },
      ];
    default:
      return [];
  }
}

/** Two people can share a name, so the detail (their email) is part of the label. */
function chipOf(option: ChoiceOption): Chip {
  return {
    id: option.id,
    label: option.detail ? `${option.label} · ${option.detail}` : option.label,
  };
}

/** The turns as Ask AI transcript messages; buttons become its follow-up suggestions. */
export function toChatMessages(turns: readonly AssistantTurn[]): Message[] {
  return turns.map(turn => ({
    id: `${MESSAGE_ID_PREFIX}${turn.id}`,
    type: turn.role === 'user' ? 'user' : 'bot',
    content: turn.text,
    timestamp: turn.at,
    ...(turn.chips?.length ? { followUpSuggestions: turn.chips.map(chip => chip.label) } : {}),
  }));
}

export function isAssistantMessage(messageId: string): boolean {
  return messageId.startsWith(MESSAGE_ID_PREFIX);
}

/** The live button with this label: only the latest turn's buttons can be pressed. */
export function chipWithLabel(turns: readonly AssistantTurn[], label: string): Chip | undefined {
  return turns.at(-1)?.chips?.find(chip => chip.label === label);
}

/**
 * What the voice view shows: the latest reply as text, with its buttons when it asked
 * something, or starter buttons when the assistant is free for a new request.
 */
export function stageContent(turns: readonly AssistantTurn[]): StageContent {
  const latest = turns.at(-1);
  if (!latest) return { prompt: 'What can I help with?', chips: STARTERS, caption: null };
  // The user just spoke or tapped; the reply is on its way.
  if (latest.role !== 'assistant') return { prompt: null, chips: [], caption: null };
  const caption = latest.text.trim()
    ? {
        text: latest.text,
        tone: latest.tone === 'error' ? ('error' as const) : ('default' as const),
      }
    : null;
  if (latest.chips?.length) return { prompt: null, chips: latest.chips, caption };
  if (latest.expectsReply) return { prompt: null, chips: [], caption };
  return { prompt: 'Anything else?', chips: STARTERS, caption };
}
