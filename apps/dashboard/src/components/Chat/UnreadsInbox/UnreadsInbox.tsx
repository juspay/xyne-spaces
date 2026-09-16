import { ReactElement, useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useAllVisibleChannels, useUserChannelStatuses } from '../../../hooks/useChannels';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { useChannelSort } from '../../../hooks/useChannelSort';
import { useAllUnreadCount } from '../../../hooks/useUnreadCount';
import { MessageSquareDot, ChevronDown, ChevronUp, Check } from 'lucide-react';
import ChannelItemV2 from '../ChatDirectory/ChannelItemV2';
import { ChannelType, ChannelScopeType, isDeskChannelType } from '@xyne/shared';
import ConversationPanelV2 from '../ConversationPannel/ConversationPanelV2';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { getDraft } from '../../../hooks/useDraft';
import { v4 as uuidv4 } from 'uuid';
import Button from '../../ui/Button';
import Tooltip from '../../ui/Tooltip';
import { ResizableGroup, Panel, Separator } from '../../ui/Resizable/Resizable';
import { ThreadMessages } from '../ThreadPannel';

// Collapsed-row estimate (measureElement corrects it after first paint) plus the
// space-y-4 gap, baked in here since virtualized rows are absolutely positioned
// and can't rely on margin-between-siblings like a normal-flow list can.
const ROW_GAP = 16;
const COLLAPSED_ROW_ESTIMATE = 56 + ROW_GAP;

// Fallback until a channel's real content height is measured (contentHeights
// below). Not unreadCount-based — unreadCounts tracks unread activities, not
// message-list length.
const FALLBACK_OPEN_PANEL_HEIGHT_RATIO = 0.6;

// Caps real measured content height at a full screen. Must be an explicit
// pixel height, not CSS max-height/auto — ChatListV4's virtualized list
// needs a resolved height to scroll internally.
const getOpenPanelHeight = (measuredHeight: number | undefined): number => {
  const height = measuredHeight ?? window.innerHeight * FALLBACK_OPEN_PANEL_HEIGHT_RATIO;
  return Math.min(window.innerHeight, height);
};
const OPEN_ROW_ESTIMATE = (measuredHeight: number | undefined): number =>
  getOpenPanelHeight(measuredHeight) + 56 + ROW_GAP;

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
  const zero = useZero();

  const [activeThread, setActiveThread] = useState<{
    channelId: string;
    conversationId: string;
  } | null>(null);

  const [scrollContainer, setScrollContainer] = useState<HTMLDivElement | null>(null);
  const manualTogglesRef = useRef<Record<string, boolean>>({});
  const [manualTogglesVersion, setManualTogglesVersion] = useState(0);
  // Read by estimateSize, which runs inside useVirtualizer before openChannelIds
  // (derived from its own output below) exists for this render — one render
  // stale is fine, measureElement corrects the real height immediately after.
  const openChannelIdsRef = useRef<Set<string>>(new Set());
  // Real content height per open channel, reported via onTotalHeightChange.
  const [contentHeights, setContentHeights] = useState<Record<string, number>>({});
  const handleTotalHeightChange = useCallback((channelId: string, height: number) => {
    setContentHeights(prev =>
      prev[channelId] === height ? prev : { ...prev, [channelId]: height },
    );
  }, []);

  const handleMarkAsRead = (channelId: string) => {
    const draft = getDraft(channelId, null);
    const payload = {
      channelId,
      timestamp: Date.now(),
      draftMessageId: uuidv4(),
      draftMessage: draft || '',
    };
    void zero.mutate(mutators.channel.markChannelAsViewed(payload));
  };

  const handleThreadClick = useCallback((channelId: string, conversationId: string) => {
    setActiveThread({ channelId, conversationId });
  }, []);

  const unreadItems = useMemo(() => {
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

      return (
        isUnread &&
        !isDeskChannelType(c.type) &&
        c.type !== ChannelType.SUPPORT &&
        c.type !== ChannelType.SDLC
      );
    });
  }, [starred, channels, directMessages, unreadCounts, allChannelsUserStatus, context.userID]);

  // Drop toggle state for channels no longer in the unread list.
  useEffect(() => {
    const currentIds = new Set(unreadItems.map(item => item.id));
    for (const id of Object.keys(manualTogglesRef.current)) {
      if (!currentIds.has(id)) {
        delete manualTogglesRef.current[id];
      }
    }
  }, [unreadItems]);

  const rowVirtualizer = useVirtualizer({
    count: unreadItems.length,
    getScrollElement: () => scrollContainer,
    estimateSize: useCallback(
      (index: number) => {
        const item = unreadItems[index];
        const isOpen = !!item && openChannelIdsRef.current.has(item.id);
        return isOpen ? OPEN_ROW_ESTIMATE(item && contentHeights[item.id]) : COLLAPSED_ROW_ESTIMATE;
      },
      [unreadItems, contentHeights],
    ),
    getItemKey: useCallback((index: number) => unreadItems[index]?.id ?? index, [unreadItems]),
    overscan: 4,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();

  // Open = currently rendered by the virtualizer (near-visible) and not manually
  // closed, OR manually opened regardless of visibility — mirrors the previous
  // IntersectionObserver-driven behavior, just sourced from the virtualizer's
  // own visible range instead of a second, parallel visibility tracker.
  const openChannelIds = useMemo(() => {
    const visibleIds = virtualItems
      .map(vi => unreadItems[vi.index]?.id)
      .filter((id): id is string => !!id);
    return new Set([
      ...visibleIds.filter(id => manualTogglesRef.current[id] !== false),
      ...Object.keys(manualTogglesRef.current).filter(id => manualTogglesRef.current[id] === true),
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [virtualItems, unreadItems, manualTogglesVersion]);

  openChannelIdsRef.current = openChannelIds;

  const handleItemClick = (e: React.MouseEvent | React.KeyboardEvent, channelId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const isCurrentlyOpen = openChannelIdsRef.current.has(channelId);
    manualTogglesRef.current[channelId] = !isCurrentlyOpen;
    setManualTogglesVersion(v => v + 1);
  };

  const inboxContent = (
    <div className='flex-1 h-full w-full bg-background flex flex-col pt-14 [@media(min-width:500px)]:pt-0 min-h-0'>
      <div className='relative z-30 shrink-0 px-6 py-4 border-b border-border/50 bg-background flex items-center justify-between'>
        <div className='flex items-center gap-2 text-foreground'>
          <MessageSquareDot className='w-5 h-5 text-primary' />
          <h1 className='text-lg font-semibold tracking-tight'>Unreads</h1>
        </div>
      </div>

      <div
        ref={setScrollContainer}
        className='relative z-0 flex-1 isolate overflow-y-auto overflow-x-hidden px-4 pb-4 pt-0'
      >
        {unreadItems.length === 0 ? (
          <div className='flex flex-col items-center justify-center h-full text-center'>
            <MessageSquareDot className='text-muted-foreground mb-4' size={64} />
            <p className='text-muted-foreground text-xl font-semibold mb-2'>
              You&apos;re all caught up!
            </p>
            <p className='text-muted-foreground'>No unread channels or direct messages.</p>
          </div>
        ) : (
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              position: 'relative',
              width: '100%',
            }}
          >
            {virtualItems.map(virtualItem => {
              const channel = unreadItems[virtualItem.index];
              if (!channel) return null;

              const isOpen = openChannelIds.has(channel.id);
              const status = allChannelsUserStatus.find(
                s => s.channelId === channel.id && s.userId === context.userID,
              );

              return (
                <div
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  ref={rowVirtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    // `top` instead of `transform: translateY(...)` deliberately — a
                    // transformed ancestor becomes a new containing block, which
                    // traps this row's `sticky` header instead of letting it stick
                    // against the real outer scroll container.
                    top: `${virtualItem.start}px`,
                    left: 0,
                    width: '100%',
                    paddingBottom: `${ROW_GAP}px`,
                  }}
                >
                  <div
                    className={`border rounded-lg bg-card transition-colors shadow-sm relative ${isOpen ? 'isolate overflow-visible border-border/50' : 'overflow-hidden border-border/30 hover:bg-accent'}`}
                  >
                    <div
                      role='button'
                      tabIndex={0}
                      onClick={e => handleItemClick(e, channel.id)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          handleItemClick(e, channel.id);
                        }
                      }}
                      className={`px-2 py-1 cursor-pointer flex items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isOpen ? 'sticky top-0 z-20 rounded-t-lg bg-background border-b border-border/20' : ''}`}
                      data-track-category='UNREADS_INBOX'
                      data-track-name='TOGGLE_CHANNEL_ACCORDION'
                    >
                      <div className='flex-1 pointer-events-none'>
                        <ChannelItemV2 channel={channel} unreadCount={0} hideDraftIndicator />
                      </div>
                      <div className='pr-3 text-muted-foreground flex items-center gap-3'>
                        {isOpen && (
                          <Tooltip content='Mark as read' side='top' sideOffset={6}>
                            <Button
                              variant='secondary'
                              size='sm'
                              className='h-7 w-7 p-0 pointer-events-auto rounded-md opacity-80 hover:opacity-100 shadow-sm'
                              aria-label='Mark as read'
                              onClick={e => {
                                e.stopPropagation();
                                handleMarkAsRead(channel.id);
                              }}
                              data-track-category='UNREADS_INBOX'
                              data-track-name='MARK_AS_READ'
                            >
                              <Check className='w-3.5 h-3.5' />
                            </Button>
                          </Tooltip>
                        )}
                        {isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                      </div>
                    </div>

                    {isOpen && (
                      <div className='overflow-hidden rounded-b-lg'>
                        <div
                          className='animate-in slide-in-from-top-2 fade-in duration-200 flex flex-col relative z-0'
                          style={{ height: getOpenPanelHeight(contentHeights[channel.id]) }}
                        >
                          <ConversationPanelV2
                            channelId={channel.id}
                            previousChannelId={null}
                            linkedItemCreatedAtOverride={status?.lastViewedAt ?? null}
                            showHeader={false}
                            hideComposer
                            skipMarkAsRead={true}
                            skipSubscription={true}
                            unreadsOnly={true}
                            onThreadClick={handleThreadClick}
                            onTotalHeightChange={height =>
                              handleTotalHeightChange(channel.id, height)
                            }
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <ResizableGroup orientation='horizontal' className='w-full h-full'>
      <Panel id='inbox' defaultSize={activeThread ? 60 : 100} minSize={30}>
        {inboxContent}
      </Panel>

      {activeThread && (
        <>
          <Separator className='w-1 bg-border/50 hover:bg-border transition-colors' />
          <Panel id='thread' defaultSize={40} minSize={25} className='relative flex flex-col'>
            <div className='flex-1 relative min-h-0'>
              <ThreadMessages
                channelId={activeThread.channelId}
                conversationId={activeThread.conversationId}
                onClose={() => setActiveThread(null)}
              />
            </div>
          </Panel>
        </>
      )}
    </ResizableGroup>
  );
};

export default UnreadsInbox;
