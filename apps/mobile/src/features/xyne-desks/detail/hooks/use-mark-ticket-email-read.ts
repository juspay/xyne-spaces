import { useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';

import { useAuth } from '@/src/contexts/AuthContext';
import { useZero } from '@/src/hooks/useZero';
import { mutators } from '@/src/zero/mutators';

import type { TicketDetailReadSnapshot } from '../types';

/**
 * Thread-level read state (dashboard parity).
 * Ticket is read when email_reads.lastReadEmailAt >= ticket.lastEmailAt.
 */
export function useMarkTicketEmailRead(
  ticketId: string | null | undefined,
  latestEmailId: string | null | undefined,
  lastEmailAt: number | null | undefined,
  emailReads: readonly TicketDetailReadSnapshot[] | undefined,
  shouldMark: boolean,
): { isRead: boolean } {
  const { user } = useAuth();
  const userId = user?.user_id ?? '';
  const zero = useZero();

  const userRow = (emailReads ?? []).find(r => r.userId === userId);
  const lastReadAt = userRow?.lastReadEmailAt;
  const isRead =
    typeof lastEmailAt === 'number' && typeof lastReadAt === 'number' && lastReadAt >= lastEmailAt;

  const markedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!shouldMark) return;
    if (!ticketId || !latestEmailId) return;
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
