import { logger, Event as LogEvent } from '../../utils/logger';
import { ReactElement, useState, useEffect, useCallback, useMemo } from 'react';
import { CalendarClock } from 'lucide-react';
import { Button } from '../../components/ui/Button/Button';
import ScheduledMessageModal from '../../components/ScheduledMessage/ScheduledMessageModal';
import ScheduledMessageCard from '../../components/ScheduledMessage/ScheduledMessageCard';
import { ScheduledMessageFilters } from '../../components/ScheduledMessage/ScheduledMessageFilters';
import { scheduledMessageApi, type ScheduledMessage } from '../../services/scheduledMessageService';
import { useAllChannels, useUserChannelStatuses } from '../../hooks/useChannels';
import { useUsers, useSelf } from '../../hooks/useUsers';
import { ChannelVisibility } from '@xyne/shared';

const ScheduledMessageScreen = (): ReactElement => {
  const [scheduledMessages, setScheduledMessages] = useState<ScheduledMessage[] | undefined>(
    undefined,
  );
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedScheduledMessage, setSelectedScheduledMessage] = useState<
    ScheduledMessage | undefined
  >(undefined);
  const [filters, setFilters] = useState<{ channelIds: string[]; createdByIds: string[] }>({
    channelIds: [],
    createdByIds: [],
  });

  const allChannels = useAllChannels();
  const allUsers = useUsers();
  const self = useSelf();
  const userChannelStatuses = useUserChannelStatuses();

  const loading = scheduledMessages === undefined;

  const fetchMessages = useCallback(async () => {
    try {
      const messages = await scheduledMessageApi.list();
      setScheduledMessages(messages);
    } catch (error) {
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('[ScheduledMessageScreen] Failed to fetch scheduled messages:'),
        error: error,
      });
      setScheduledMessages([]);
    }
  }, []);

  useEffect(() => {
    void fetchMessages();
  }, [fetchMessages]);

  // Set default filter to "Created by Me" when data loads
  useEffect(() => {
    if (scheduledMessages && self?.id) {
      setFilters(prev => {
        if (prev.createdByIds.length === 0) {
          return { channelIds: [], createdByIds: [self.id] };
        }
        return prev;
      });
    }
  }, [scheduledMessages, self]);

  // Build lookup maps for filter dropdowns
  const channelsMap = useMemo(() => {
    const map = new Map<string, string>();
    allChannels.forEach(channel => {
      map.set(channel.id, channel.name);
    });
    return map;
  }, [allChannels]);

  const usersMap = useMemo(() => {
    const map = new Map<string, string>();
    allUsers.forEach(user => {
      map.set(user.id, user.name || user.email || 'Unknown');
    });
    return map;
  }, [allUsers]);

  // Build set of accessible channel IDs (channels user is a member of)
  const accessibleChannelIds = useMemo(() => {
    const statusMap = new Map(userChannelStatuses.map(s => [s.channelId, s]));
    return new Set(
      allChannels
        .filter(channel => {
          // Public channels are always accessible
          if (channel.visibility === ChannelVisibility.PUBLIC) return true;
          // Private channels require membership (has a channel_user_status record)
          return statusMap.has(channel.id);
        })
        .map(c => c.id),
    );
  }, [allChannels, userChannelStatuses]);

  // Messages from accessible channels only (for filter dropdowns)
  const accessibleMessages = useMemo(() => {
    if (!scheduledMessages) return [];
    return scheduledMessages.filter(msg => accessibleChannelIds.has(msg.channelId));
  }, [scheduledMessages, accessibleChannelIds]);

  // Apply filters to accessible messages (for display)
  const filteredMessages = useMemo(() => {
    return accessibleMessages.filter(msg => {
      const channelMatch =
        filters.channelIds.length === 0 || filters.channelIds.includes(msg.channelId);
      const creatorMatch =
        filters.createdByIds.length === 0 || filters.createdByIds.includes(msg.createdBy);
      return channelMatch && creatorMatch;
    });
  }, [accessibleMessages, filters]);

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
    <div
      data-testid='scheduled-messages-page'
      className='h-full w-full bg-background md:rounded-2xl overflow-hidden shadow-md'
    >
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
              data-track-category='scheduled-message'
              data-track-name='CreateScheduledMessage'
            >
              Create Scheduled Message
            </Button>
          </div>

          {/* Filters */}
          <div className='p-4 pb-0'>
            <ScheduledMessageFilters
              messages={accessibleMessages}
              channelsMap={channelsMap}
              usersMap={usersMap}
              currentUserId={self?.id || ''}
              filters={filters}
              onFiltersChange={setFilters}
            />
          </div>

          {/* Create/Edit Modal */}
          <ScheduledMessageModal
            open={isModalOpen}
            onOpenChange={handleModalClose}
            onSaved={handleSaved}
            {...(selectedScheduledMessage && { scheduledMessage: selectedScheduledMessage })}
          />

          <div className='flex-1 overflow-y-auto p-4'>
            {filteredMessages.length > 0 ? (
              <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4'>
                {filteredMessages.map((scheduledMessage: ScheduledMessage) => {
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
