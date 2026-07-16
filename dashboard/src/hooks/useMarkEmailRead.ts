import { useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useZero } from './useZero';
import { useAuthContextValues } from './useAuth';
import { mutators } from '../zero/mutators';

type EmailReadRow = { userId: string; lastReadEmailAt: number };

/**
 * Thread-level read state for the xyne desk.
 *
 * Rule: a ticket (= one email thread) is "read" for a user when their
 * `email_reads.lastReadEmailAt` — a snapshot of `ticket.lastEmailAt` taken
 * when they last opened the thread — is at or after the ticket's current
 * `lastEmailAt`. Opening the ticket upserts that row. When a reply arrives,
 * `lastEmailAt` advances past the stored snapshot — unread.
 *
 * Assignment state is intentionally NOT a shortcut — auto-assigned boards
 * would otherwise mark every inbound email read for everyone instantly.
 */
export function useMarkEmailRead(
  ticketId: string | null | undefined,
  latestEmailId: string | null | undefined,
  lastEmailAt: number | null | undefined,
  emailReads: readonly EmailReadRow[] | undefined,
  shouldMark: boolean,
): { isRead: boolean } {
  const { userID } = useAuthContextValues();
  const zero = useZero();

  const userRow = (emailReads ?? []).find(r => r.userId === userID);
  const lastReadAt = userRow?.lastReadEmailAt;
  const isRead =
    typeof lastEmailAt === 'number' && typeof lastReadAt === 'number' && lastReadAt >= lastEmailAt;

  const markedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!shouldMark) return;
    if (!ticketId) return;
    if (!latestEmailId) return;
    if (markedRef.current === latestEmailId) return;
    markedRef.current = latestEmailId;
    if (isRead) return;
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
