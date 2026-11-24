import {
  CONTINUATION_TOP_OFFSET,
  MESSAGE_AVATAR_SIZE,
  MESSAGE_BODY_LINE_HEIGHT,
  MESSAGE_PADDING_Y,
  SWIPE_ASK_AI_THRESHOLD,
  SWIPE_REPLY_THRESHOLD,
  SWIPE_RUBBER_BAND_FACTOR,
  SWIPE_RUBBER_BAND_MAX,
} from '../constants';

/** The hold-menu actions a swipe runs, by their `MessageAction` ids. */
export type SwipeActionId = 'reply-in-thread' | 'ask-ai';

export type SwipeDirections = Readonly<{ reply: boolean; askAI: boolean }>;

export type SwipeRowFacts = Readonly<{
  /** The room lets the user act on messages (joined, not a channel preview). */
  canAct: boolean;
  /** Not yet sent, or failed: no thread or message to ask about exists. */
  isPending: boolean;
  isDeleted: boolean;
  /** A thread reply also sent to the room: the hold menu offers no reply on it, as its thread is the parent's. */
  isShownInChannel: boolean;
}>;

/**
 * Which ways a row may be swiped, following the hold menu: nothing on a room
 * the user cannot act in or an unsent message, no reply on a thread reply, no
 * Ask AI on a deleted message.
 */
export function swipeDirections(facts: SwipeRowFacts): SwipeDirections {
  const open = facts.canAct && !facts.isPending;
  return {
    reply: open && !facts.isShownInChannel,
    askAI: open && !facts.isDeleted,
  };
}

/**
 * The distance a row moves for a finger that has moved `distance`: one to one
 * up to `threshold`, then a rubber band that starts at the band factor and
 * approaches the band cap without reaching it.
 */
export function rubberBand(distance: number, threshold: number): number {
  'worklet';
  if (distance <= threshold) return distance;
  const overshoot = distance - threshold;
  return (
    threshold +
    SWIPE_RUBBER_BAND_MAX *
      (1 - 1 / ((overshoot * SWIPE_RUBBER_BAND_FACTOR) / SWIPE_RUBBER_BAND_MAX + 1))
  );
}

/** The row's offset for a drag: positive to reply, negative to ask; a closed way does not move. */
export function swipeOffset(translationX: number, directions: SwipeDirections): number {
  'worklet';
  if (translationX > 0) {
    return directions.reply ? rubberBand(translationX, SWIPE_REPLY_THRESHOLD) : 0;
  }
  if (translationX < 0) {
    return directions.askAI ? -rubberBand(-translationX, SWIPE_ASK_AI_THRESHOLD) : 0;
  }
  return 0;
}

/** How far toward its threshold the row has uncovered an action, 0 to 1. */
export function swipeReveal(offset: number, action: SwipeActionId): number {
  'worklet';
  const distance = action === 'reply-in-thread' ? offset : -offset;
  const threshold = action === 'reply-in-thread' ? SWIPE_REPLY_THRESHOLD : SWIPE_ASK_AI_THRESHOLD;
  return Math.min(1, Math.max(0, distance / threshold));
}

/** The action a release at `offset` runs, if the row is past a threshold. */
export function swipeCommitAction(offset: number): SwipeActionId | null {
  'worklet';
  if (offset >= SWIPE_REPLY_THRESHOLD) return 'reply-in-thread';
  if (offset <= -SWIPE_ASK_AI_THRESHOLD) return 'ask-ai';
  return null;
}

/**
 * Top of an affordance of `size`, centred on the row's first line: the avatar
 * on a block's first message, the first line of words on a continuation (which
 * pulls up under the row above, so it may sit a little above the row's box).
 */
export function swipeAffordanceTop(isContinuation: boolean, size: number): number {
  return isContinuation
    ? CONTINUATION_TOP_OFFSET + (MESSAGE_BODY_LINE_HEIGHT - size) / 2
    : MESSAGE_PADDING_Y + (MESSAGE_AVATAR_SIZE - size) / 2;
}
