import { ReactElement, useMemo, useState } from 'react';
import { useAllVisibleChannels, useUserChannelStatuses } from '../../../hooks/useChannels';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { useChannelSort } from '../../../hooks/useChannelSort';
import { useAllUnreadCount } from '../../../hooks/useUnreadCount';
import { MessageSquareDot, ChevronDown, ChevronUp, Check } from 'lucide-react';
import ChannelItemV2 from '../ChatDirectory/ChannelItemV2';
import { ChannelType, ChannelScopeType, isDeskChannelType } from '@xyne/shared';
import ConversationPanelV2 from '../ConversationPannel/ConversationPanelV2';
import { useEffect, useRef } from 'react';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { getDraft } from '../../../hooks/useDraft';
import { v4 as uuidv4 } from 'uuid';
import Button from '../../ui/Button';

const ScrollToView = ({ isOpen }: { isOpen: boolean }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 50);
    }
  }, [isOpen]);
  return <div ref={ref} className='absolute -top-[60px]' />;
};

const UnreadsInbox = (): ReactElement => {
  const channelData = useAllVisibleChannels();
  const allChannelsUserStatus = useUserChannelStatuses();
  const context = useAuthContextValues();

  const { starred, channels, directMessages } = useChannelSort(
    channelData,
    allChannelsUserStatus,
    context.userID,
  );

  const unreadCounts = useAllUnreadCount();
  const [openChannelId, setOpenChannelId] = useState<string | null>(null);
  const zero = useZero();

  const handleMarkAsRead = (channelId: string) => {
    const draft = getDraft(channelId, null);
    const payload = {
      channelId,
      timestamp: Date.now(),
      draftMessageId: uuidv4(),
      draftMessage: draft || '',
    };
    void zero.mutate(mutators.channel.markChannelAsViewed(payload));
    if (openChannelId === channelId) {
      setOpenChannelId(null);
    }
  };

  const unreadItems = useMemo(() => {
    // DMs first since we surface their unread count prominently, then starred, then channels.
    const allOrdered = [...directMessages, ...starred, ...channels];
    return allOrdered.filter(c => {
      const status = allChannelsUserStatus.find(
        s => s.channelId === c.id && s.userId === context.userID,
      );
      const isDM = c.scopeType === ChannelScopeType.DM || c.scopeType === ChannelScopeType.GROUP_DM;
      const hasUnreadCount = (unreadCounts[c.id] ?? 0) > 0;

      let isUnread = hasUnreadCount;
      if (!isDM) {
        const hasNewActivity =
          !!status?.lastViewedAt &&
          !!c.channelStats?.lastActivityAt &&
          c.channelStats.lastActivityAt > status.lastViewedAt;
        isUnread = hasUnreadCount || hasNewActivity;
      }

      // Keep the currently open channel visible even if it becomes read
      if (openChannelId === c.id) {
        isUnread = true;
      }

      return isUnread && !isDeskChannelType(c.type) && c.type !== ChannelType.SUPPORT;
    });
  }, [
    starred,
    channels,
    directMessages,
    unreadCounts,
    allChannelsUserStatus,
    context.userID,
    openChannelId,
  ]);

  const handleItemClick = (e: React.MouseEvent | React.KeyboardEvent, channelId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setOpenChannelId((prev: string | null) => (prev === channelId ? null : channelId));
  };

  return (
    <div className='flex-1 h-full w-full bg-background flex flex-col pt-14 [@media(min-width:500px)]:pt-0'>
      <div className='px-6 py-4 border-b border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 z-10 flex items-center justify-between'>
        <div className='flex items-center gap-2 text-foreground'>
          <MessageSquareDot className='w-5 h-5 text-primary' />
          <h1 className='text-lg font-semibold tracking-tight'>Unreads</h1>
        </div>
      </div>

      <div className='flex-1 overflow-y-auto overflow-x-hidden p-4 relative'>
        {unreadItems.length === 0 ? (
          <div className='flex flex-col items-center justify-center h-full text-center'>
            <MessageSquareDot className='text-muted-foreground mb-4' size={64} />
            <p className='text-muted-foreground text-xl font-semibold mb-2'>
              You&apos;re all caught up!
            </p>
            <p className='text-muted-foreground'>No unread channels or direct messages.</p>
          </div>
        ) : (
          <div className='space-y-4'>
            {unreadItems.map(channel => {
              const isOpen = openChannelId === channel.id;

              const status = allChannelsUserStatus.find(
                s => s.channelId === channel.id && s.userId === context.userID,
              );

              return (
                <div
                  key={channel.id}
                  className={`border rounded-lg bg-card transition-colors shadow-sm overflow-hidden relative ${isOpen ? 'border-border/50 bg-accent/20' : 'border-border/30 hover:bg-accent'}`}
                >
                  {isOpen && <ScrollToView isOpen={isOpen} />}
                  <div
                    role='button'
                    tabIndex={0}
                    onClick={e => handleItemClick(e, channel.id)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        handleItemClick(e, channel.id);
                      }
                    }}
                    className='p-1 cursor-pointer flex items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                    data-track-category='UNREADS_INBOX'
                    data-track-name='TOGGLE_CHANNEL_ACCORDION'
                  >
                    <div className='flex-1 pointer-events-none'>
                      <ChannelItemV2 channel={channel} unreadCount={0} />
                    </div>
                    <div className='pr-3 text-muted-foreground flex items-center gap-3'>
                      {isOpen && (
                        <Button
                          variant='secondary'
                          size='sm'
                          className='h-6 text-[11px] px-3 font-medium pointer-events-auto rounded-full gap-1.5 opacity-80 hover:opacity-100 shadow-sm'
                          onClick={e => {
                            e.stopPropagation();
                            handleMarkAsRead(channel.id);
                          }}
                        >
                          <Check className='w-3 h-3' />
                          Mark as read
                        </Button>
                      )}
                      {isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </div>
                  </div>

                  {isOpen && (
                    <div className='animate-in slide-in-from-top-2 fade-in duration-200 border-t border-border/20 h-[calc(100vh-200px)] flex flex-col relative'>
                      <ConversationPanelV2
                        channelId={channel.id}
                        previousChannelId={null}
                        linkedItemCreatedAtOverride={status?.lastViewedAt ?? null}
                        showHeader={false}
                        hideComposer
                        skipMarkAsRead={true}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default UnreadsInbox;
