import { useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useZero } from './useZero';
import { mutators } from '../zero/mutators';

/**
 * Marks a Desk ticket's latest email as read when its detail thread opens.
 * The mutator performs the existing-row comparison, so the detail view does
 * not need to subscribe to email_reads before issuing this idempotent update.
 */
export function useMarkEmailRead(
  ticketId: string | null | undefined,
  latestEmailId: string | null | undefined,
  shouldMark: boolean,
): void {
  const zero = useZero();

  const markedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!shouldMark) return;
    if (!ticketId) return;
    if (!latestEmailId) return;
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
  }, [shouldMark, ticketId, latestEmailId, zero]);
}
