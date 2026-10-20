import type { ReactElement } from 'react';

import type { HoldRect } from './hold-menu';

/**
 * What the hold menu needs to lift a row: a way to read where the row is on
 * screen right now, and the element that draws its copy.
 */
export type HoldSource = {
  measure: (onMeasured: (rect: HoldRect | null) => void) => void;
  content: ReactElement;
};

const sources = new Map<string, HoldSource>();
/** The hold whose open haptic has played, so a remount of the same hold stays quiet. */
let hapticHold: string | null = null;

/** A row registers itself as it is long-pressed; the menu reads it by conversation id. */
export function setHoldSource(conversationId: string, source: HoldSource): void {
  sources.clear();
  hapticHold = null;
  sources.set(conversationId, source);
}

export function getHoldSource(conversationId: string | undefined): HoldSource | undefined {
  return conversationId ? sources.get(conversationId) : undefined;
}

/** True the first time a hold is claimed; false for later claims until it is cleared or re-registered. */
export function claimHoldHaptic(conversationId: string): boolean {
  if (hapticHold === conversationId) return false;
  hapticHold = conversationId;
  return true;
}

export function clearHoldSource(conversationId?: string): void {
  if (conversationId === undefined || hapticHold === conversationId) hapticHold = null;
  if (conversationId === undefined) sources.clear();
  else sources.delete(conversationId);
}
