import { ReactElement, useState, useRef, useEffect } from 'react';
import { ChevronDown, X, Search, ArrowLeft, MoreVertical, Loader2 } from 'lucide-react';
import { Popover } from '../../../ui/Popover';
import { Drawer } from '../../../ui/Drawer/Drawer';
import type { ConversationHistory as ConversationHistoryType } from '../utils/XyneAITypes';
import { usePlatform } from '../../../../hooks/usePlatform';
import { XyneDelete } from '../../../icons/xyne-ai';
import { formatRelativeTime } from '../../../../utils/dateUtils';
import { AgentSelector } from './AgentSelector';
import type { AgentOption } from './AgentSelector';

interface ConversationHistoryProps {
  conversations: ConversationHistoryType[];
  conversationId: string;
  loadingSessionId: string | null;
  streamingSessionIds: string[];
  onBack: () => void;
  onLoadConversation: (conversation: ConversationHistoryType) => void;
  onDeleteConversation: (conversation: ConversationHistoryType) => Promise<void>;
  selectedAgentSlug?: string | null;
  agents?: AgentOption[];
  onSelectAgent?: (slug: string | null) => void;
  isLoading?: boolean;
  onClose?: () => void;
  agentSelectorDisabled?: boolean;
}

// Helper function to group conversations by date
const groupConversationsByDate = (
  conversations: ConversationHistoryType[],
): Record<string, ConversationHistoryType[]> => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const groups: Record<string, ConversationHistoryType[]> = {
    Today: [],
    Yesterday: [],
  };

  conversations.forEach(conv => {
    const convDate = new Date(conv.lastUpdated);
    convDate.setHours(0, 0, 0, 0);

    if (convDate.getTime() === today.getTime()) {
      groups['Today']!.push(conv);
    } else if (convDate.getTime() === yesterday.getTime()) {
      groups['Yesterday']!.push(conv);
    } else {
      const dateKey = convDate.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: convDate.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
      });
      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(conv);
    }
  });

  return groups;
};

export const ConversationHistory = ({
  conversations,
  conversationId,
  loadingSessionId,
  streamingSessionIds,
  onBack,
  onLoadConversation,
  onDeleteConversation,
  onClose,
  selectedAgentSlug,
  agents,
  onSelectAgent,
  isLoading = false,
  agentSelectorDisabled = false,
}: ConversationHistoryProps): ReactElement => {
  const { isMobile } = usePlatform();
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);

  const handleClose = (): void => {
    onClose?.();
  };

  return (
    <div className='flex-1 overflow-hidden flex flex-col h-full'>
      {/* Header */}
      <div className='p-4 flex items-center justify-between gap-2 self-stretch border-border flex-shrink-0'>
        {isSearchExpanded ? (
          <>
            <button
              onClick={() => {
                setIsSearchExpanded(false);
                setSearchQuery('');
              }}
              className={
                isMobile
                  ? 'flex w-8 h-8 justify-center items-center rounded-full border border-[#FFF] bg-[linear-gradient(180deg,_#FFF_0%,_#FAFAFA_100%)] shadow-[inset_0_4px_6px_0_#F5F5F5,0_0_12px_0_#E5E5E5] shrink-0'
                  : 'p-1 hover:bg-accent rounded transition-colors flex-shrink-0'
              }
              data-track-category='XyneAI'
              data-track-name='CloseSearch'
              data-track-metadata={JSON.stringify({ conversationId })}
            >
              <ArrowLeft
                className={isMobile ? 'w-4 h-4 text-foreground' : 'w-4 h-4 text-foreground'}
              />
            </button>
            <div className='flex-1 flex items-center gap-2 bg-popover rounded-lg h-8 border border-border px-3 py-2'>
              <input
                type='text'
                placeholder='Search chats...'
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="flex-1 bg-transparent outline-none text-foreground placeholder:text-muted-foreground text-sm font-['Inter']"
                data-track-category='XyneAI'
                data-track-name='SearchChatsInput'
                autoFocus={!isMobile}
              />
              <Search className='w-4 h-4 text-muted-foreground' />
            </div>
            {!isMobile && (
              <button
                onClick={handleClose}
                className='p-2 rounded-lg outline outline-1 outline-offset-[-1px] outline-border flex justify-center items-center gap-2.5 overflow-hidden hover:bg-accent transition-colors'
                data-track-category='XyneAI'
                data-track-name='CloseHistory'
              >
                <X className='w-4 h-4 text-muted-foreground' />
              </button>
            )}
          </>
        ) : (
          <>
            <div className='flex items-center gap-2'>
              <button
                onClick={onBack}
                className={
                  isMobile
                    ? 'flex w-8 h-8 justify-center items-center rounded-full border border-[#FFF] bg-[linear-gradient(180deg,_#FFF_0%,_#FAFAFA_100%)] shadow-[inset_0_4px_6px_0_#F5F5F5,0_0_12px_0_#E5E5E5] shrink-0'
                    : 'p-1 hover:bg-accent rounded transition-colors'
                }
                data-track-category='XyneAI'
                data-track-name='BackFromHistory'
              >
                <ArrowLeft className='w-4 h-4 text-foreground' />
              </button>
              <span className="text-foreground text-base font-semibold font-['Inter']">Chats</span>
            </div>
            <div className='flex items-center gap-2'>
              {agents && agents.length > 0 && onSelectAgent && (
                <AgentSelector
                  selectedAgentSlug={selectedAgentSlug ?? null}
                  agents={agents}
                  onSelect={onSelectAgent}
                  disabled={agentSelectorDisabled}
                  compact={true}
                />
              )}
              <button
                onClick={() => setIsSearchExpanded(true)}
                className={
                  isMobile
                    ? 'flex w-8 h-8 justify-center items-center rounded-full border border-[#FFF] bg-[linear-gradient(180deg,_#FFF_0%,_#FAFAFA_100%)] shadow-[inset_0_4px_6px_0_#F5F5F5,0_0_12px_0_#E5E5E5] shrink-0'
                    : 'p-2 rounded-lg outline outline-1 outline-offset-[-1px] outline-border flex justify-center items-center gap-2.5 overflow-hidden hover:bg-accent transition-colors'
                }
                data-track-category='XyneAI'
                data-track-name='OpenSearch'
              >
                <Search
                  className={
                    isMobile ? 'w-4 h-4 text-muted-foreground' : 'w-4 h-4 text-muted-foreground'
                  }
                />
              </button>
              {!isMobile && (
                <button
                  onClick={handleClose}
                  className='p-2 rounded-lg outline outline-1 outline-offset-[-1px] outline-border flex justify-center items-center gap-2.5 overflow-hidden hover:bg-accent transition-colors'
                  data-track-category='XyneAI'
                  data-track-name='CloseHistory'
                >
                  <X className='w-4 h-4 text-muted-foreground' />
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* Conversations List */}
      <div className='flex-1 overflow-y-auto min-h-0'>
        {isLoading ? (
          <div className='flex h-full items-center justify-center'>
            <Loader2
              aria-label='Loading conversations'
              className='size-5 animate-spin text-muted-foreground'
            />
          </div>
        ) : isMobile ? (
          // Mobile: Date-based grouping
          <>
            {((): (ReactElement | null)[] => {
              const filteredConversations = conversations.filter(
                c =>
                  searchQuery === '' || c.title.toLowerCase().includes(searchQuery.toLowerCase()),
              );
              const groupedByDate = groupConversationsByDate(filteredConversations);

              return Object.entries(groupedByDate).map(([dateKey, convs]) => {
                if (convs.length === 0) return null;
                return (
                  <ConversationSection
                    key={dateKey}
                    title={dateKey}
                    conversations={convs}
                    currentConversationId={conversationId}
                    loadingSessionId={loadingSessionId}
                    streamingSessionIds={streamingSessionIds}
                    openDropdownId={openDropdownId}
                    onLoadConversation={onLoadConversation}
                    onDeleteConversation={onDeleteConversation}
                    setOpenDropdownId={setOpenDropdownId}
                    isMobile={isMobile}
                  />
                );
              });
            })()}

            {/* Empty state */}
            {conversations.filter(
              c => searchQuery === '' || c.title.toLowerCase().includes(searchQuery.toLowerCase()),
            ).length === 0 && (
              <div className='px-4 py-8 text-center text-muted-foreground text-sm'>
                {searchQuery
                  ? `No chats found matching "${searchQuery}"`
                  : 'No conversations yet. Start a new chat!'}
              </div>
            )}
          </>
        ) : (
          // Desktop: Original layout
          <ConversationSection
            title='All Chats'
            conversations={conversations.filter(
              c => searchQuery === '' || c.title.toLowerCase().includes(searchQuery.toLowerCase()),
            )}
            currentConversationId={conversationId}
            loadingSessionId={loadingSessionId}
            streamingSessionIds={streamingSessionIds}
            openDropdownId={openDropdownId}
            onLoadConversation={onLoadConversation}
            onDeleteConversation={onDeleteConversation}
            setOpenDropdownId={setOpenDropdownId}
            isMobile={isMobile}
            emptyMessage={
              searchQuery
                ? `No chats found matching "${searchQuery}"`
                : 'No conversations yet. Start a new chat!'
            }
          />
        )}
      </div>
    </div>
  );
};

interface ConversationSectionProps {
  title: string;
  conversations: ConversationHistoryType[];
  currentConversationId: string;
  loadingSessionId: string | null;
  streamingSessionIds: string[];
  openDropdownId: string | null;
  onLoadConversation: (conversation: ConversationHistoryType) => void;
  onDeleteConversation: (conversation: ConversationHistoryType) => Promise<void>;
  setOpenDropdownId: (id: string | null) => void;
  isMobile: boolean;
  emptyMessage?: string;
}

const ConversationSection = ({
  title,
  conversations,
  currentConversationId,
  loadingSessionId,
  streamingSessionIds,
  openDropdownId,
  onLoadConversation,
  onDeleteConversation,
  setOpenDropdownId,
  isMobile,
  emptyMessage,
}: ConversationSectionProps): ReactElement => (
  <div className={isMobile ? 'bg-muted rounded-[12px] mx-4 my-4' : ''}>
    <details open>
      <summary
        className={
          isMobile
            ? "px-4 py-3 cursor-pointer flex items-center justify-between text-sm text-muted-foreground font-medium font-['Inter']"
            : "px-4 py-2 cursor-pointer hover:bg-accent flex items-center justify-between text-sm text-muted-foreground font-medium font-['Inter']"
        }
      >
        <span>{title}</span>
        <ChevronDown className='w-4 h-4' />
      </summary>
      <div className={isMobile ? 'pb-2 px-2' : 'pb-2'}>
        {conversations
          .sort((a, b) => b.lastUpdated.getTime() - a.lastUpdated.getTime())
          .map(conversation => (
            <ConversationItem
              key={conversation.id}
              conversation={conversation}
              isActive={conversation.sessionId === currentConversationId}
              isLoadingRow={loadingSessionId === conversation.sessionId}
              isStreamingRow={
                streamingSessionIds.includes(conversation.sessionId) ||
                streamingSessionIds.includes(conversation.id)
              }
              isDropdownOpen={openDropdownId === conversation.id}
              onLoad={() => onLoadConversation(conversation)}
              onDelete={() => {
                if (window.confirm('Delete this conversation?')) {
                  void onDeleteConversation(conversation);
                }
              }}
              setOpenDropdownId={setOpenDropdownId}
              isMobile={isMobile}
            />
          ))}
        {conversations.length === 0 && emptyMessage && (
          <div className='px-4 py-8 text-center text-muted-foreground text-sm'>{emptyMessage}</div>
        )}
      </div>
    </details>
  </div>
);

interface ConversationItemProps {
  conversation: ConversationHistoryType;
  isActive: boolean;
  isLoadingRow: boolean;
  isStreamingRow: boolean;
  isDropdownOpen: boolean;
  isMobile: boolean;
  onLoad: () => void;
  onDelete: () => void;
  setOpenDropdownId: (id: string | null) => void;
}

const ConversationItem = ({
  conversation,
  isActive,
  isLoadingRow,
  isStreamingRow,
  isDropdownOpen,
  isMobile,
  onLoad,
  onDelete,
  setOpenDropdownId,
}: ConversationItemProps): ReactElement => {
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const longPressTriggeredRef = useRef(false);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
      }
    };
  }, []);

  const handleTouchStart = (e: React.TouchEvent<HTMLButtonElement>): void => {
    longPressTriggeredRef.current = false;
    const touch = e.touches[0];
    if (touch) {
      touchStartPosRef.current = { x: touch.clientX, y: touch.clientY };
    }

    // Start long press timer (500ms)
    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true;
      setOpenDropdownId(conversation.id);
      // Add haptic feedback on supported devices
      if ('vibrate' in navigator) {
        navigator.vibrate(50);
      }
    }, 500);
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLButtonElement>): void => {
    // Cancel long press if user moves finger too much (drag detection)
    if (touchStartPosRef.current && longPressTimerRef.current) {
      const touch = e.touches[0];
      if (touch) {
        const deltaX = Math.abs(touch.clientX - touchStartPosRef.current.x);
        const deltaY = Math.abs(touch.clientY - touchStartPosRef.current.y);

        // If moved more than 10px, cancel long press
        if (deltaX > 10 || deltaY > 10) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }
      }
    }
  };

  const handleTouchEnd = (): void => {
    // Clear long press timer if touch ends before threshold
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    touchStartPosRef.current = null;
  };

  const handleClick = (): void => {
    // Prevent click if long press was triggered
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      return;
    }
    onLoad();
  };

  return (
    <div
      className={
        isMobile
          ? `relative w-full px-3 py-3 rounded-lg transition-colors flex items-center gap-3 group ${
              isActive ? 'bg-background' : ''
            }`
          : `relative w-full px-4 py-3 hover:bg-accent transition-colors flex items-center gap-3 group ${
              isActive ? 'bg-primary/10 border-l-2 border-primary' : ''
            }`
      }
    >
      <button
        onClick={handleClick}
        className='flex-1 min-w-0 text-left'
        onTouchStart={isMobile ? handleTouchStart : undefined}
        onTouchMove={isMobile ? handleTouchMove : undefined}
        onTouchEnd={isMobile ? handleTouchEnd : undefined}
        onTouchCancel={isMobile ? handleTouchEnd : undefined}
        data-track-category='XyneAI'
        data-track-name='SELECT_CONVERSATION'
        data-track-metadata={JSON.stringify({ conversationId: conversation.id })}
      >
        <div
          className={
            isMobile
              ? `text-[14px] leading-[20px] tracking-[0.14px] text-foreground font-['Inter'] min-w-0 flex items-center gap-2 ${
                  isActive ? 'font-semibold' : 'font-normal'
                }`
              : `text-sm text-foreground font-normal font-['Inter'] min-w-0 flex items-center gap-2`
          }
        >
          {isLoadingRow && (
            <Loader2 className='w-3.5 h-3.5 shrink-0 animate-spin text-muted-foreground' />
          )}
          <span className='truncate'>{conversation.title}</span>
          {isStreamingRow && (
            <span className='shrink-0 text-[10px] uppercase tracking-wide text-primary/80'>
              Responding
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground font-['Inter'] mt-0.5 flex items-center gap-1 flex-wrap">
          <span>{formatRelativeTime(conversation.lastUpdated)}</span>
          {(() => {
            const channels = (conversation.lastInputContext?.selectedChannels ?? []) as Array<{
              id: string;
              name: string;
            }>;
            if (!channels.length) return null;
            const PILL_COLORS = [
              'bg-blue-100 text-blue-700 border border-blue-200 hover:bg-blue-200',
              'bg-purple-100 text-purple-700 border border-purple-200 hover:bg-purple-200',
              'bg-green-100 text-green-700 border border-green-200 hover:bg-green-200',
              'bg-orange-100 text-orange-700 border border-orange-200 hover:bg-orange-200',
              'bg-pink-100 text-pink-700 border border-pink-200 hover:bg-pink-200',
              'bg-teal-100 text-teal-700 border border-teal-200 hover:bg-teal-200',
              'bg-red-100 text-red-700 border border-red-200 hover:bg-red-200',
              'bg-yellow-100 text-yellow-700 border border-yellow-200 hover:bg-yellow-200',
              'bg-indigo-100 text-indigo-700 border border-indigo-200 hover:bg-indigo-200',
              'bg-cyan-100 text-cyan-700 border border-cyan-200 hover:bg-cyan-200',
            ];
            const getColor = (id: string) => {
              let hash = 0;
              for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
              return PILL_COLORS[hash % PILL_COLORS.length]!;
            };
            const visible = channels.slice(0, 2);
            const overflow = channels.length - 2;
            return (
              <>
                <div className='w-px h-3 bg-border' />
                {visible.map(ch => (
                  <span
                    key={ch.id}
                    className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md text-[10px] font-semibold leading-none shadow-sm cursor-default select-none transition-colors ${getColor(ch.id)}`}
                  >
                    # {ch.name}
                  </span>
                ))}
                {overflow > 0 && (
                  <span className='text-[10px] text-muted-foreground font-medium'>+{overflow}</span>
                )}
              </>
            );
          })()}
        </div>
      </button>
      {isMobile && isActive && (
        <svg
          xmlns='http://www.w3.org/2000/svg'
          width='4'
          height='4'
          viewBox='0 0 4 4'
          fill='none'
          className='flex-shrink-0'
        >
          <circle cx='2' cy='2' r='2' fill='hsl(var(--destructive))' />
        </svg>
      )}
      {isMobile ? (
        <Drawer
          open={isDropdownOpen}
          onOpenChange={(open: boolean) => setOpenDropdownId(open ? conversation.id : null)}
          title='Conversation Options'
          description='Manage this conversation'
        >
          <div className='flex flex-col bg-popover rounded-t-[20px] overflow-hidden'>
            <button
              onClick={e => {
                e.stopPropagation();
                onDelete();
                setOpenDropdownId(null);
              }}
              data-ph-capture-attribute-track-id='delete_conversation'
              className='w-full px-4 py-4 text-left text-sm active:bg-accent flex items-center gap-3 text-destructive touch-manipulation'
              data-track-category='XyneAI'
              data-track-name='DELETE_CONVERSATION'
              data-track-metadata={JSON.stringify({ conversationId: conversation.id })}
            >
              <XyneDelete color='currentColor' />
              <span>Delete</span>
            </button>
          </div>
        </Drawer>
      ) : (
        <Popover
          open={isDropdownOpen}
          onOpenChange={open => setOpenDropdownId(open ? conversation.id : null)}
          align='end'
          sideOffset={4}
          trigger={
            <button
              onClick={e => e.stopPropagation()}
              className='opacity-0 group-hover:opacity-100 p-1 hover:bg-accent rounded'
              data-track-category='XyneAI'
              data-track-name='OPEN_CONVERSATION_MENU'
            >
              <MoreVertical className='w-4 h-4 text-muted-foreground' />
            </button>
          }
          className='w-48 p-0 bg-popover border border-border rounded-lg shadow-lg'
        >
          <button
            onClick={e => {
              e.stopPropagation();
              onDelete();
              setOpenDropdownId(null);
            }}
            data-ph-capture-attribute-track-id='delete_conversation'
            className='w-full px-4 py-2 text-left text-sm hover:bg-accent flex items-center gap-2 text-destructive'
            data-track-category='XyneAI'
            data-track-name='DELETE_DESKTOP'
            data-track-metadata={JSON.stringify({ conversationId: conversation.id })}
          >
            <XyneDelete color='currentColor' />
            <span>Delete</span>
          </button>
        </Popover>
      )}
    </div>
  );
};
