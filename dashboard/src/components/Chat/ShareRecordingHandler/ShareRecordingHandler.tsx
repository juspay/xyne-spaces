import React, { useState, useEffect, useCallback } from 'react';
import {
  reactNativeBridge,
  NativeInboundMessageType,
  NativeOutboundMessageType,
} from '../../../utils/reactNativeBridge';
import { ForwardMessageForm } from '../ForwardMessageModal/ForwardMessageModal';
import { Dialog } from '../../ui/Dialog/Dialog';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import { logger, Event } from '../../../utils/logger';

/**
 * ShareRecordingHandler listens for SHARE_RECORDING bridge events from the native
 * RecordingDetailScreen and opens the ForwardMessageModal with the recording's head message.
 *
 * Uses the same Zero query pattern as BookmarkItem and other components
 * to look up the message by ID — no custom API needed.
 *
 * This component should be rendered at the app root level (e.g. in AppRoot.tsx).
 */
export const ShareRecordingHandler: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messageId, setMessageId] = useState<string | null>(null);

  // Query the message from Zero — same pattern as BookmarkItem.tsx
  const [message] = useCachedQuery(queries.getMessageForActivityV2({ messageId: messageId ?? '' }));

  // Listen for SHARE_RECORDING bridge events
  useEffect(() => {
    if (!reactNativeBridge.isAvailable()) {
      logger.error(Event.SHARE_RECORDING_ERROR, { errorType: 'bridge_not_available' });
      return;
    }

    const unsubscribe = reactNativeBridge.on(NativeInboundMessageType.SHARE_RECORDING, msg => {
      const id = msg.payload?.messageId;
      if (id) {
        logger.info(Event.SHARE_RECORDING, { messageId: id });
        setMessageId(id);
        setIsOpen(true);
      } else {
        logger.error(Event.SHARE_RECORDING_ERROR, { errorType: 'missing_message_id_in_payload' });
      }
    });

    return unsubscribe;
  }, []);

  const handleCancel = useCallback(() => {
    setIsOpen(false);
    setMessageId(null);
    // Signal native app to restore the recording screen
    reactNativeBridge.send(NativeOutboundMessageType.RESTORE_RECORDING_SCREEN);
  }, []);

  const handleSuccess = useCallback(() => {
    setIsOpen(false);
    setMessageId(null);
    // Clear native restoration state on success
    reactNativeBridge.send(NativeOutboundMessageType.CLEAR_RECORDING_STATE);
  }, []);

  if (!isOpen || !message) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && handleCancel()}>
      <ForwardMessageForm
        message={message}
        channelId={''}
        onCancel={handleCancel}
        onSuccess={handleSuccess}
      />
    </Dialog>
  );
};
