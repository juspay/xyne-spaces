import { useCallback, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useZero } from './useZero';
import { mutators } from '../zero/mutators';
import { trackDeskOutcome } from '../services/Analytics/deskTracking';
import { logger, Event as LoggerEvent } from '../utils/logger';
import { afterUncovering, usePageCoverage } from './usePageCoverage';

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
  // Under full-page search the thread is not being read: what arrives then waits until it is seen.
  const coverage = usePageCoverage();

  const markedRef = useRef<string | null>(null);
  const latestRef = useRef({ ticketId, latestEmailId, shouldMark });
  latestRef.current = { ticketId, latestEmailId, shouldMark };

  const markLatest = useCallback((): void => {
    const { ticketId: id, latestEmailId: emailId, shouldMark: enabled } = latestRef.current;
    if (!enabled || coverage.isCovered()) return;
    if (!id) return;
    if (!emailId) return;
    if (markedRef.current === emailId) return;
    markedRef.current = emailId;
    void zero
      .mutate(
        mutators.emailRead.markAsRead({
          id: uuidv4(),
          ticketId: id,
          lastReadEmailId: emailId,
          updatedAt: Date.now(),
        }),
      )
      .client.then(
        () => {
          // Opening the thread is the implicit "mark read"; the manual and bulk
          // variants report the same outcome with their own trigger.
          trackDeskOutcome(
            'READ_STATE_CHANGED',
            { id },
            {},
            {
              to: 'read',
              trigger: 'open',
              bulkCount: 1,
            },
          );
        },
        (err: unknown) => {
          // Same handling as useMarkTicketsAsRead: a client-mutator failure is
          // logged, not left as an unhandled rejection.
          logger.error(LoggerEvent.ZERO_MUTATION_ERROR, {
            hook: 'useMarkEmailRead',
            mutator: 'emailRead.markAsRead',
            error: err instanceof Error ? err.message : String(err),
          });
        },
      );
  }, [zero, coverage]);

  useEffect(() => markLatest(), [shouldMark, ticketId, latestEmailId, markLatest]);
  // Uncovered: the thread is on screen again, with whatever arrived meanwhile.
  useEffect(
    () =>
      coverage.subscribe(covered => {
        if (!covered) afterUncovering(markLatest);
      }),
    [coverage, markLatest],
  );
}
