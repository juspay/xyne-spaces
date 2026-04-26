import { useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useZero } from './useZero';
import { useAuthContextValues } from './useAuth';
import { mutators } from '../zero/mutators';

type EmailReadRow = { userId: string; lastReadEmailId: string };

/**
 * Thread-level read state for the xyne desk.
 *
 * Rule: a ticket (= one email thread) is "read" for a user only when that
 * user has an `email_reads` row whose `lastReadEmailId` equals the id of the
 * latest email currently in the thread. Opening the ticket upserts that row
 * with the current latest email id. When a reply arrives, the latest email
 * id changes, and the existing row naturally represents "stale" — unread.
 *
 * Assignment state is intentionally NOT a shortcut — auto-assigned boards
 * would otherwise mark every inbound email read for everyone instantly.
 */
export function useMarkEmailRead(
  ticketId: string | null | undefined,
  latestEmailId: string | null | undefined,
  emailReads: readonly EmailReadRow[] | undefined,
  shouldMark: boolean,
): { isRead: boolean } {
  const { userID } = useAuthContextValues();
  const zero = useZero();

  const userRow = (emailReads ?? []).find(r => r.userId === userID);
  const isRead = !!latestEmailId && userRow?.lastReadEmailId === latestEmailId;

  const markedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!shouldMark) return;
    if (!ticketId) return;
    if (!latestEmailId) return;
    if (isRead) return;
    if (markedRef.current === latestEmailId) return;
    markedRef.current = latestEmailId;
    void zero.mutate(
      mutators.emailRead.markAsRead({
        id: uuidv4(),
        ticketId,
        lastReadEmailId: latestEmailId,
        updatedAt: Date.now(),
      }),
    );
  }, [shouldMark, ticketId, latestEmailId, isRead, zero]);

  return { isRead };
}
