import type { LandingTarget } from '../machine/openState';
import { windowContainsTarget, type TargetableRow } from '../data/windowContainsTarget';

export type LiveWindowForHandover = {
  rows: readonly TargetableRow[];
  isSettled: boolean;
};

/**
 * I8 — a live window may supersede a warm one only when it is settled and can
 * land the same target the warm window already holds.
 */
export const isAuthoritativeFor = (
  live: LiveWindowForHandover,
  warm: { containsTarget: boolean } | null,
  target: LandingTarget,
): boolean => {
  if (!live.isSettled) {
    return false;
  }
  if (warm?.containsTarget === true) {
    return windowContainsTarget(live.rows, target);
  }
  return true;
};
