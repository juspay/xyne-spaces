import type { ChatPaintRow } from '@/src/features/chat/v2/paint/chatPaint.types';
import { startOfLocalDay } from '@/src/features/dms/model/timestamp';

import { isRestyledRow } from './row-policy';

/** Messages further apart than this start a new block. */
export const CONTINUATION_WINDOW_MS = 5 * 60_000;

export type ContinuationOptions = {
  /**
   * A thread strip ends a block, so a message with replies is never followed by
   * a continuation. The thread screen draws no strips, so it turns this off.
   */
  stripEndsBlock?: boolean;
  /** The row above is a flow card, which keeps the classic row. */
  previousIsFlowJson?: boolean;
  /**
   * `current` shows a send status (the pending clock or the failed mark). Both
   * live beside the time, so the row keeps its header while it has one.
   */
  showsSendStatus?: boolean;
};

/**
 * Whether `current` joins the block `previous` ends: same sender, same
 * calendar day, within five minutes, with nothing in between that closes the
 * block (a deletion, a thread strip, a row the flat layout does not restyle).
 *
 * `previous` is the row directly above, or undefined when that is a divider
 * or there is none.
 */
export function isContinuationRow(
  previous: ChatPaintRow | undefined,
  current: ChatPaintRow,
  {
    stripEndsBlock = true,
    previousIsFlowJson = false,
    showsSendStatus = false,
  }: ContinuationOptions = {},
): boolean {
  if (!previous || showsSendStatus) return false;
  if (!isRestyledRow(previous, { isFlowJson: previousIsFlowJson }) || !isRestyledRow(current)) {
    return false;
  }
  if (previous.isDeleted) return false;
  if (stripEndsBlock && (previous.replyPreview?.count ?? previous.replyCount) > 0) return false;

  const senderId = current.senderPaintModel.senderId;
  if (!senderId || senderId !== previous.senderPaintModel.senderId) return false;

  const gap = current.createdAt - previous.createdAt;
  if (gap < 0 || gap > CONTINUATION_WINDOW_MS) return false;
  return startOfLocalDay(previous.createdAt) === startOfLocalDay(current.createdAt);
}
