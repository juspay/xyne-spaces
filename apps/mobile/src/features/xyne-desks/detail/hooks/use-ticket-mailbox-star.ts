import { useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';

import { useCachedQuery } from '@/src/hooks/useCachedQuery';
import { useZero } from '@/src/hooks/useZero';
import { haptics } from '@/src/utils/haptics';
import { showMessageToast } from '@/src/utils/toast';
import { awaitMutation } from '@/src/zero/awaitMutation';
import { mutators } from '@/src/zero/mutators';
import { queries } from '@/src/zero/queries';

export type UseTicketMailboxStarArgs = {
  ticketId: string | null | undefined;
  channelId: string;
  enabled?: boolean;
};

export type UseTicketMailboxStarReturn = {
  starred: boolean;
  toggleStar: () => void;
};

/**
 * EMAIL desk star — dashboard MailboxActions parity.
 * Reads `myTicketMailbox`; absence means not starred. Persists via
 * `ticketMailbox.setStarred`.
 */
export function useTicketMailboxStar({
  ticketId,
  channelId,
  enabled = true,
}: UseTicketMailboxStarArgs): UseTicketMailboxStarReturn {
  const zero = useZero();
  const canQuery = Boolean(enabled && ticketId);

  const [rows] = useCachedQuery(queries.myTicketMailbox({ ticketId: ticketId ?? '' }), {
    enabled: canQuery,
  });
  const starred = rows?.[0]?.starred === true;

  const toggleStar = useCallback(() => {
    if (!ticketId || !channelId || !enabled) return;

    void haptics.selection();
    const next = !starred;
    void (async () => {
      try {
        await awaitMutation(
          zero.mutate(
            mutators.ticketMailbox.setStarred({
              id: uuidv4(),
              ticketId,
              channelId,
              starred: next,
              timestamp: Date.now(),
            }),
          ),
        );
      } catch (err) {
        showMessageToast(
          err instanceof Error
            ? err.message
            : next
              ? 'Failed to star ticket'
              : 'Failed to unstar ticket',
          'error',
        );
      }
    })();
  }, [ticketId, channelId, enabled, starred, zero]);

  return { starred, toggleStar };
}
