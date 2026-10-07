import type { Transition } from 'motion/react';

/** Timing for the floating test chat, from the Digital Twin motion tokens. Keep in step with draft-chat.css. */
export const DRAFT_CHAT_EASE_OUT = [0.22, 1, 0.36, 1] as const;

export const DRAFT_CHAT_MOTION = {
  layout: 0.3,
  entrance: 0.42,
} as const;

/**
 * The test chat card rising out from behind the composer, and folding back.
 * Open: a quick spring with a little bounce, so the card lands with a slight
 * settle. Fold: Granola's quick ease-out over 200ms.
 */
export const DRAFT_CHAT_CARD_MOTION: { open: Transition; fold: Transition } = {
  // The animated value runs 0-1 across the whole panel, so the default rest
  // distance (0.01) would end it with a few px jump.
  open: { type: 'spring', visualDuration: 0.2, bounce: 0.2, restDelta: 0.001, restSpeed: 0.01 },
  fold: { type: 'tween', duration: 0.2, ease: [...DRAFT_CHAT_EASE_OUT] },
};

/**
 * What the bar says while the chat is folded away (as Granola's does): where
 * the reply is, or that there is a chat to go back to.
 */
export function composerPlaceholder(state: {
  folded: boolean;
  pending: boolean;
  /** The reply has started to stream. */
  replying: boolean;
  idle: string;
}): string {
  if (!state.folded) return state.idle;
  if (state.pending) return state.replying ? 'Replying…' : 'Thinking…';
  return 'Continue chat';
}
