import { ReactElement, useMemo, useState } from 'react';
import { useAllVisibleChannels, useUserChannelStatuses } from '../../../hooks/useChannels';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { useChannelSort } from '../../../hooks/useChannelSort';
import { useAllUnreadCount } from '../../../hooks/useUnreadCount';
import { MessageSquareDot, ChevronDown, ChevronUp } from 'lucide-react';
import ChannelItemV2 from '../ChatDirectory/ChannelItemV2';
import { ChannelType, ChannelScopeType } from '@xyne/shared';
import ConversationPanelV2 from '../ConversationPannel/ConversationPanelV2';
import { useEffect, useRef } from 'react';

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

  const unreadItems = useMemo(() => {
    const allOrdered = [...starred, ...channels, ...directMessages];
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

      return isUnread && c.type !== ChannelType.EMAIL && c.type !== ChannelType.SUPPORT;
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

  const handleItemClick = (e: React.MouseEvent, channelId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setOpenChannelId((prev: string | null) => (prev === channelId ? null : channelId));
  };

  return (
    <div className='flex-1 flex flex-col h-full bg-background overflow-hidden relative'>
      <div className='flex items-center justify-between px-6 py-3 border-b border-border'>
        <h1 className='text-xl font-semibold'>Unreads</h1>
      </div>

      <div className='flex-1 overflow-y-auto px-4 py-2 w-full'>
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
                    onClickCapture={e => handleItemClick(e, channel.id)}
                    className='p-1 cursor-pointer flex items-center'
                  >
                    <div className='flex-1 pointer-events-none'>
                      <ChannelItemV2
                        channel={channel}
                        unreadCount={unreadCounts[channel.id] ?? 0}
                      />
                    </div>
                    <div className='pr-3 text-muted-foreground'>
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
