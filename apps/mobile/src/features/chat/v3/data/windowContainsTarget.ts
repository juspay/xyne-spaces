import type { LandingTarget } from '../machine/openState';

export type TargetableRow = {
  conversationId?: string;
  initialMessageId?: string | null;
  messageId?: string | null;
};

export const windowContainsTarget = (
  rows: readonly TargetableRow[],
  target: LandingTarget,
): boolean => {
  if (rows.length === 0) {
    return false;
  }
  if (target.kind === 'tail') {
    return true;
  }
  if (target.messageId) {
    return rows.some(
      row => row.messageId === target.messageId || row.initialMessageId === target.messageId,
    );
  }
  return false;
};
