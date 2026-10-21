import { useEffect } from 'react';
import { recheckTicketDuplicates } from '../services/ticketDuplicateService';

// Wait this long on a ticket before checking, so arrowing through a queue doesn't fire a
// check for every ticket passed on the way.
const OPEN_SETTLE_MS = 800;

/**
 * Re-runs duplicate detection whenever a desk ticket is opened. A new match is linked
 * server-side and reaches DuplicateTicketsBanner through Zero; the server reuses the last
 * result when nothing changed. Silent: a failure (or a 429 because a check for this
 * ticket is already running) just leaves the banner as it was.
 */
export const useRecheckTicketDuplicates = (ticketId: string | null | undefined): void => {
  useEffect(() => {
    if (!ticketId) return;
    const timer = setTimeout((): void => {
      recheckTicketDuplicates(ticketId).catch(() => {});
    }, OPEN_SETTLE_MS);
    return (): void => clearTimeout(timer);
  }, [ticketId]);
};
