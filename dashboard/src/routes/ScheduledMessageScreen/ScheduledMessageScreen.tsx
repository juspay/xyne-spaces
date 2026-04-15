import { ReactElement, useState, useEffect, useCallback } from 'react';
import { CalendarClock } from 'lucide-react';
import { Button } from '../../components/ui/Button/Button';
import ScheduledMessageModal from '../../components/ScheduledMessage/ScheduledMessageModal';
import ScheduledMessageCard from '../../components/ScheduledMessage/ScheduledMessageCard';
import { scheduledMessageApi, type ScheduledMessage } from '../../services/scheduledMessageService';

const ScheduledMessageScreen = (): ReactElement => {
  const [scheduledMessages, setScheduledMessages] = useState<ScheduledMessage[] | undefined>(
    undefined,
  );
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedScheduledMessage, setSelectedScheduledMessage] = useState<
    ScheduledMessage | undefined
  >(undefined);

  const loading = scheduledMessages === undefined;

  const fetchMessages = useCallback(async () => {
    try {
      const messages = await scheduledMessageApi.list();
      setScheduledMessages(messages);
    } catch (error) {
      console.error('[ScheduledMessageScreen] Failed to fetch scheduled messages:', error);
      setScheduledMessages([]);
    }
  }, []);

  useEffect(() => {
    void fetchMessages();
  }, [fetchMessages]);

  const handleCreateClick = (): void => {
    setSelectedScheduledMessage(undefined);
    setIsModalOpen(true);
  };

  const handleScheduledMessageClick = (scheduledMessage: ScheduledMessage): void => {
    setSelectedScheduledMessage(scheduledMessage);
    setIsModalOpen(true);
  };

  const handleModalClose = (open: boolean): void => {
    if (!open) {
      setIsModalOpen(false);
      setSelectedScheduledMessage(undefined);
    }
  };

  const handleSaved = (): void => {
    void fetchMessages();
  };

  if (loading) {
    return (
      <div className='h-full bg-background flex items-center justify-center'>
        <p className='text-muted-foreground'>Loading...</p>
      </div>
    );
  }

  return (
    <div className='h-full w-full bg-background md:rounded-2xl overflow-hidden shadow-md'>
      <div className='h-full overflow-hidden'>
        <div className='flex flex-col h-full'>
          <div className='flex items-center justify-between p-6 border-b border-border bg-background'>
            <div>
              <h2 className='text-lg font-bold text-foreground'>Scheduled Messages</h2>
              <p className='text-xs text-muted-foreground mt-1'>
                Manage recurring scheduled messages for channels
              </p>
            </div>
            <Button
              onClick={handleCreateClick}
              data-track-category='ScheduledMessages'
              data-track-name='CreateScheduledMessage'
            >
              Create Scheduled Message
            </Button>
          </div>

          {/* Create/Edit Modal */}
          <ScheduledMessageModal
            open={isModalOpen}
            onOpenChange={handleModalClose}
            onSaved={handleSaved}
            {...(selectedScheduledMessage && { scheduledMessage: selectedScheduledMessage })}
          />

          <div className='flex-1 overflow-y-auto p-4'>
            {scheduledMessages && scheduledMessages.length > 0 ? (
              <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4'>
                {scheduledMessages.filter(Boolean).map((scheduledMessage: ScheduledMessage) => {
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
            ) : (
              <div className='text-center py-16'>
                <CalendarClock className='mx-auto text-muted-foreground mb-4' size={64} />
                <h3 className='text-xl font-semibold text-foreground mb-2'>
                  No scheduled messages yet
                </h3>
                <p className='text-muted-foreground'>
                  Get started by creating your first scheduled message
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

ScheduledMessageScreen.displayName = 'ScheduledMessageScreen';

export default ScheduledMessageScreen;
