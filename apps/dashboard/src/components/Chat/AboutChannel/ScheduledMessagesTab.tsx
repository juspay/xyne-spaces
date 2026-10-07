import { logger, Event as LogEvent } from '../../../utils/logger';
import { ReactElement, useCallback, useEffect, useMemo, useState } from 'react';
import ScheduledMessageModal from '../../ScheduledMessage/ScheduledMessageModal';
import ScheduledMessageForm from '../../ScheduledMessage/ScheduledMessageForm';
import ScheduledMessageCard from '../../ScheduledMessage/ScheduledMessageCard';
import {
  scheduledMessageApi,
  type ScheduledMessage,
} from '../../../services/scheduledMessageService';

export interface ScheduledMessagesTabProps {
  channelId: string;
}

const ScheduledMessagesTab = ({ channelId }: ScheduledMessagesTabProps): ReactElement => {
  const [scheduledMessages, setScheduledMessages] = useState<ScheduledMessage[] | undefined>(
    undefined,
  );
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedScheduledMessage, setSelectedScheduledMessage] = useState<
    ScheduledMessage | undefined
  >(undefined);

  const loading = scheduledMessages === undefined;

  const fetchMessages = useCallback(async () => {
    try {
      const messages = await scheduledMessageApi.list();
      setScheduledMessages(messages);
    } catch (error) {
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('[ScheduledMessagesTab] Failed to fetch scheduled messages:'),
        error: error,
      });
      setScheduledMessages([]);
    }
  }, []);

  useEffect(() => {
    void fetchMessages();
  }, [fetchMessages]);

  const channelMessages = useMemo(
    () => (scheduledMessages ?? []).filter(msg => msg.channelId === channelId),
    [scheduledMessages, channelId],
  );

  const handleScheduledMessageClick = (scheduledMessage: ScheduledMessage): void => {
    setSelectedScheduledMessage(scheduledMessage);
    setIsEditModalOpen(true);
  };

  const handleEditModalClose = (open: boolean): void => {
    if (!open) {
      setIsEditModalOpen(false);
      setSelectedScheduledMessage(undefined);
    }
  };

  const handleSaved = (): void => {
    void fetchMessages();
  };

  if (loading) {
    return (
      <div className='h-full flex items-center justify-center'>
        <p className='text-muted-foreground'>Loading...</p>
      </div>
    );
  }

  return (
    <div className='h-full flex flex-col'>
      <div className='p-4 border-b border-border shrink-0'>
        <p className='text-xs text-muted-foreground'>
          Recurring messages scheduled for this channel
        </p>
      </div>

      <ScheduledMessageModal
        open={isEditModalOpen}
        onOpenChange={handleEditModalClose}
        onSaved={handleSaved}
        {...(selectedScheduledMessage && { scheduledMessage: selectedScheduledMessage })}
      />

      <div className='flex-1 overflow-y-auto p-4 space-y-6'>
        <ScheduledMessageForm lockedChannelId={channelId} onSaved={handleSaved} />

        {channelMessages.length > 0 && (
          <div className='space-y-3 border-t border-border pt-4'>
            <h3 className='text-sm font-semibold text-foreground'>Scheduled messages</h3>
            <div className='grid grid-cols-1 gap-4'>
              {channelMessages.map((scheduledMessage: ScheduledMessage) => {
                if (!scheduledMessage?.id) {
                  return null;
                }
                return (
                  <ScheduledMessageCard
                    key={scheduledMessage.id}
                    scheduledMessage={scheduledMessage}
                    onClick={() => handleScheduledMessageClick(scheduledMessage)}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ScheduledMessagesTab;
