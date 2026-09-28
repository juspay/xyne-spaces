import React, { type ReactElement } from 'react';
import {
  firePendingMutator,
  removePending,
  usePendingByMessageId,
  usePendingStatusByMessageId,
} from '@xyne/shared/messages';
import { useZero } from '../../../hooks/useZero';

type PendingSendStatusProps = {
  messageId: string;
  /** Left padding differs between the channel list and a thread. */
  className?: string;
};

/**
 * The retry/discard line shown under a message the server rejected.
 *
 * Rendered by both the channel list and the thread list so the two stay in
 * step. The hover actions toolbar is suppressed for unconfirmed messages (see
 * ChatBubble) because nothing in it operates on a row the server does not have,
 * so these are the only two actions available — and both are purely local:
 * retry re-fires the same messageId, discard drops the pending entry.
 */
const PendingSendStatusComponent = ({
  messageId,
  className = 'pl-12',
}: PendingSendStatusProps): ReactElement | null => {
  const zero = useZero();
  const pendingEntry = usePendingByMessageId(messageId);
  const pendingStatus = usePendingStatusByMessageId(messageId);

  if (pendingStatus !== 'failed' || !pendingEntry) return null;

  return (
    <div className={`flex items-center gap-1.5 pt-1 text-xs text-red-500 ${className}`}>
      <button
        type='button'
        data-ph-capture-attribute-track-id='retry_failed_send'
        data-track-category='PENDING_MESSAGE'
        data-track-name='retry_failed_send'
        className='hover:opacity-80'
        onClick={() => firePendingMutator(zero, pendingEntry)}
      >
        Failed to send. Tap to retry
      </button>
      <span aria-hidden='true'>&middot;</span>
      <button
        type='button'
        data-ph-capture-attribute-track-id='delete_failed_send'
        data-track-category='PENDING_MESSAGE'
        data-track-name='delete_failed_send'
        className='hover:underline'
        onClick={() => removePending(pendingEntry.messageId)}
      >
        Delete
      </button>
    </div>
  );
};

export const PendingSendStatus = React.memo(PendingSendStatusComponent);
