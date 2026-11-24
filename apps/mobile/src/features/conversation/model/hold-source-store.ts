import type { ReactElement } from 'react';

import type { HoldRect } from './hold-menu';

/**
 * What the hold menu needs to lift a row: a way to read where the row is on
 * screen right now, and the element that draws its copy.
 */
type HoldSource = {
  measure: (onMeasured: (rect: HoldRect | null) => void) => void;
  content: ReactElement;
};

/** Only one message is held at a time, so the latest registration replaces the last. */
let held: { messageId: string; source: HoldSource } | null = null;
/** The hold whose open haptic has played, so a remount of the same hold stays quiet. */
let hapticHold: string | null = null;

/**
 * A row registers itself as it is long-pressed; the menu reads it back by
 * message id. Keyed by message, not conversation: inside a thread every reply
 * shares the thread's conversation id.
 */
export function setHoldSource(messageId: string, source: HoldSource): void {
  held = { messageId, source };
  hapticHold = null;
}

export function getHoldSource(messageId: string | undefined): HoldSource | undefined {
  return messageId && held?.messageId === messageId ? held.source : undefined;
}

/** True the first time a hold is claimed; false for later claims until it is cleared or re-registered. */
export function claimHoldHaptic(messageId: string): boolean {
  if (hapticHold === messageId) return false;
  hapticHold = messageId;
  return true;
}

export function clearHoldSource(): void {
  held = null;
  hapticHold = null;
}
