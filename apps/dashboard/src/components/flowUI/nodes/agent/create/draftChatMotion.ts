/** Timing for the floating test chat, from the Digital Twin motion tokens. Keep in step with draft-chat.css. */
export const DRAFT_CHAT_EASE_OUT = [0.22, 1, 0.36, 1] as const;

export const DRAFT_CHAT_MOTION = {
  layout: 0.3,
  entrance: 0.42,
} as const;

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
