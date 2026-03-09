import { ReactElement, useState, useRef, useEffect } from 'react';
import { ChevronDown, X, Search, ArrowLeft, MoreVertical } from 'lucide-react';
import { Popover } from '../../../ui/Popover';
import { Drawer } from '../../../ui/Drawer/Drawer';
import type { ConversationHistory as ConversationHistoryType } from '../../../../utils/xyneAIStorage';
import { xyneAIActor } from '../../../../machines/xyneAIMachine';
import { usePlatform } from '../../../../hooks/usePlatform';
import { XyneStarred, XyneUnstarred, XyneRename, XyneDelete } from '../../../icons/xyne-ai';

interface ConversationHistoryProps {
  conversations: ConversationHistoryType[];
  conversationId: string;
  onBack: () => void;
  onLoadConversation: (conversation: ConversationHistoryType) => void;
  onToggleStar: (conversation: ConversationHistoryType) => Promise<void>;
  onDeleteConversation: (conversation: ConversationHistoryType) => Promise<void>;
  onRenameConversation: (conversation: ConversationHistoryType, newName: string) => Promise<void>;
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
  onBack,
  onLoadConversation,
  onToggleStar,
  onDeleteConversation,
  onRenameConversation,
}: ConversationHistoryProps): ReactElement => {
  const { isMobile } = usePlatform();
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const handleClose = (): void => {
    // Send close event to xstate machine
    xyneAIActor.send({ type: 'CLOSE' });
  };

  const handleStartRename = (conversation: ConversationHistoryType): void => {
    setRenamingId(conversation.id);
    setRenameValue(conversation.title);
    setOpenDropdownId(null);
  };

  const handleRename = async (conversation: ConversationHistoryType): Promise<void> => {
    if (!renameValue.trim()) return;
    await onRenameConversation(conversation, renameValue.trim());
    setRenamingId(null);
    setRenameValue('');
  };

  return (
    <div className='flex-1 overflow-hidden flex flex-col bg-white h-full rounded-xl'>
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
                  ? 'flex p-4 justify-center items-center gap-2 rounded-full border border-[#FFF] bg-[linear-gradient(180deg,_#FFF_0%,_#FAFAFA_100%)] shadow-[inset_0_4px_6px_0_#F5F5F5,0_0_12px_0_#E5E5E5] aspect-square'
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
                    ? 'flex p-4 justify-center items-center gap-2 rounded-full border border-[#FFF] bg-[linear-gradient(180deg,_#FFF_0%,_#FAFAFA_100%)] shadow-[inset_0_4px_6px_0_#F5F5F5,0_0_12px_0_#E5E5E5] aspect-square'
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
              <button
                onClick={() => setIsSearchExpanded(true)}
                className={
                  isMobile
                    ? 'flex p-4 justify-center items-center gap-2 rounded-full border border-[#FFF] bg-[linear-gradient(180deg,_#FFF_0%,_#FAFAFA_100%)] shadow-[inset_0_4px_6px_0_#F5F5F5,0_0_12px_0_#E5E5E5] aspect-square'
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
        {isMobile ? (
          // Mobile: Date-based grouping
          <>
            {/* Starred Section */}
            {conversations.filter(
              c =>
                c.isStarred &&
                (searchQuery === '' || c.title.toLowerCase().includes(searchQuery.toLowerCase())),
            ).length > 0 && (
              <ConversationSection
                title='Starred'
                conversations={conversations.filter(
                  c =>
                    c.isStarred &&
                    (searchQuery === '' ||
                      c.title.toLowerCase().includes(searchQuery.toLowerCase())),
                )}
                currentConversationId={conversationId}
                renamingId={renamingId}
                renameValue={renameValue}
                openDropdownId={openDropdownId}
                onLoadConversation={onLoadConversation}
                onStartRename={handleStartRename}
                onRename={handleRename}
                onToggleStar={onToggleStar}
                onDeleteConversation={onDeleteConversation}
                setRenameValue={setRenameValue}
                setRenamingId={setRenamingId}
                setOpenDropdownId={setOpenDropdownId}
                isMobile={isMobile}
              />
            )}

            {/* Date-based sections for non-starred */}
            {((): (ReactElement | null)[] => {
              const nonStarredConversations = conversations.filter(
                c =>
                  !c.isStarred &&
                  (searchQuery === '' || c.title.toLowerCase().includes(searchQuery.toLowerCase())),
              );
              const groupedByDate = groupConversationsByDate(nonStarredConversations);

              return Object.entries(groupedByDate).map(([dateKey, convs]) => {
                if (convs.length === 0) return null;
                return (
                  <ConversationSection
                    key={dateKey}
                    title={dateKey}
                    conversations={convs}
                    currentConversationId={conversationId}
                    renamingId={renamingId}
                    renameValue={renameValue}
                    openDropdownId={openDropdownId}
                    onLoadConversation={onLoadConversation}
                    onStartRename={handleStartRename}
                    onRename={handleRename}
                    onToggleStar={onToggleStar}
                    onDeleteConversation={onDeleteConversation}
                    setRenameValue={setRenameValue}
                    setRenamingId={setRenamingId}
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
          <>
            {/* Starred Section */}
            {conversations.filter(
              c =>
                c.isStarred &&
                (searchQuery === '' || c.title.toLowerCase().includes(searchQuery.toLowerCase())),
            ).length > 0 && (
              <ConversationSection
                title='Starred'
                conversations={conversations.filter(
                  c =>
                    c.isStarred &&
                    (searchQuery === '' ||
                      c.title.toLowerCase().includes(searchQuery.toLowerCase())),
                )}
                currentConversationId={conversationId}
                renamingId={renamingId}
                renameValue={renameValue}
                openDropdownId={openDropdownId}
                onLoadConversation={onLoadConversation}
                onStartRename={handleStartRename}
                onRename={handleRename}
                onToggleStar={onToggleStar}
                onDeleteConversation={onDeleteConversation}
                setRenameValue={setRenameValue}
                setRenamingId={setRenamingId}
                setOpenDropdownId={setOpenDropdownId}
                isMobile={isMobile}
              />
            )}

            {/* All Chats Section */}
            <ConversationSection
              title='All Chats'
              conversations={conversations.filter(
                c =>
                  !c.isStarred &&
                  (searchQuery === '' || c.title.toLowerCase().includes(searchQuery.toLowerCase())),
              )}
              currentConversationId={conversationId}
              renamingId={renamingId}
              renameValue={renameValue}
              openDropdownId={openDropdownId}
              onLoadConversation={onLoadConversation}
              onStartRename={handleStartRename}
              onRename={handleRename}
              onToggleStar={onToggleStar}
              onDeleteConversation={onDeleteConversation}
              setRenameValue={setRenameValue}
              setRenamingId={setRenamingId}
              setOpenDropdownId={setOpenDropdownId}
              isMobile={isMobile}
              emptyMessage={
                searchQuery
                  ? `No chats found matching "${searchQuery}"`
                  : 'No conversations yet. Start a new chat!'
              }
            />
          </>
        )}
      </div>
    </div>
  );
};

interface ConversationSectionProps {
  title: string;
  conversations: ConversationHistoryType[];
  currentConversationId: string;
  renamingId: string | null;
  renameValue: string;
  openDropdownId: string | null;
  onLoadConversation: (conversation: ConversationHistoryType) => void;
  onStartRename: (conversation: ConversationHistoryType) => void;
  onRename: (conversation: ConversationHistoryType) => Promise<void>;
  onToggleStar: (conversation: ConversationHistoryType) => Promise<void>;
  onDeleteConversation: (conversation: ConversationHistoryType) => Promise<void>;
  setRenameValue: (value: string) => void;
  setRenamingId: (id: string | null) => void;
  setOpenDropdownId: (id: string | null) => void;
  isMobile: boolean;
  emptyMessage?: string;
}

const ConversationSection = ({
  title,
  conversations,
  currentConversationId,
  renamingId,
  renameValue,
  openDropdownId,
  onLoadConversation,
  onStartRename,
  onRename,
  onToggleStar,
  onDeleteConversation,
  setRenameValue,
  setRenamingId,
  setOpenDropdownId,
  isMobile,
  emptyMessage,
}: ConversationSectionProps): ReactElement => (
  <div
    className={
      isMobile
        ? 'bg-[#F5F6F6] rounded-[12px] mx-4 my-4'
        : title === 'Starred'
          ? 'border-b border-border'
          : ''
    }
  >
    <details open>
      <summary
        className={
          isMobile
            ? "px-4 py-3 cursor-pointer flex items-center justify-between text-sm text-[#A1A5A9] font-medium font-['Inter']"
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
              isRenaming={renamingId === conversation.id}
              renameValue={renameValue}
              isDropdownOpen={openDropdownId === conversation.id}
              onLoad={() => onLoadConversation(conversation)}
              onStartRename={() => onStartRename(conversation)}
              onRename={() => void onRename(conversation)}
              onToggleStar={() => void onToggleStar(conversation)}
              onDelete={() => {
                if (window.confirm('Delete this conversation?')) {
                  void onDeleteConversation(conversation);
                }
              }}
              setRenameValue={setRenameValue}
              setRenamingId={setRenamingId}
              setOpenDropdownId={setOpenDropdownId}
              isStarred={title === 'Starred'}
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
  isRenaming: boolean;
  renameValue: string;
  isDropdownOpen: boolean;
  isStarred: boolean;
  isMobile: boolean;
  onLoad: () => void;
  onStartRename: () => void;
  onRename: () => void;
  onToggleStar: () => void;
  onDelete: () => void;
  setRenameValue: (value: string) => void;
  setRenamingId: (id: string | null) => void;
  setOpenDropdownId: (id: string | null) => void;
}

const ConversationItem = ({
  conversation,
  isActive,
  isRenaming,
  renameValue,
  isDropdownOpen,
  isStarred,
  isMobile,
  onLoad,
  onStartRename,
  onRename,
  onToggleStar,
  onDelete,
  setRenameValue,
  setRenamingId,
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
    if (isRenaming) return;

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
          ? `relative w-full px-3 py-3 rounded-lg transition-colors flex items-center gap-3 group '
            }`
          : `relative w-full px-4 py-3 hover:bg-accent transition-colors flex items-center gap-3 group ${
              isActive ? (isStarred ? 'bg-blue-50' : 'bg-blue-50 border-l-2 border-blue-500') : ''
            }`
      }
    >
      {isRenaming ? (
        <input
          type='text'
          value={renameValue}
          onChange={e => setRenameValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              onRename();
            } else if (e.key === 'Escape') {
              setRenamingId(null);
              setRenameValue('');
            }
          }}
          onBlur={onRename}
          className={`flex-1 text-sm text-foreground font-${isStarred ? 'medium' : 'normal'} font-["Inter"] border border-border rounded px-2 py-1 outline-none focus:border-primary`}
          data-track-category='XyneAI'
          data-track-name='RENAME_CONVERSATION_INPUT'
        />
      ) : (
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
                ? `text-[14px] leading-[20px] tracking-[0.14px] text-[#181B1D] font-['Inter'] truncate ${
                    isActive ? 'font-semibold' : 'font-normal'
                  }`
                : `text-sm text-foreground font-${isStarred ? 'medium' : 'normal'} font-['Inter'] truncate`
            }
          >
            {conversation.title}
          </div>
        </button>
      )}
      {isMobile && isActive && (
        <svg
          xmlns='http://www.w3.org/2000/svg'
          width='4'
          height='4'
          viewBox='0 0 4 4'
          fill='none'
          className='flex-shrink-0'
        >
          <circle cx='2' cy='2' r='2' fill='#FF4F4F' />
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
                onToggleStar();
                setOpenDropdownId(null);
              }}
              className='w-full px-4 py-4 text-left text-sm active:bg-accent flex items-center gap-3 border-b border-border touch-manipulation'
              data-track-category='XyneAI'
              data-track-name='TOGGLE_STAR_CONVERSATION'
              data-track-metadata={JSON.stringify({ conversationId: conversation.id, isStarred })}
            >
              {isStarred || conversation.isStarred ? <XyneStarred /> : <XyneUnstarred />}
              <span>{isStarred || conversation.isStarred ? 'Unstar' : 'Star'}</span>
            </button>
            <button
              onClick={e => {
                e.stopPropagation();
                onStartRename();
                setOpenDropdownId(null);
              }}
              className='w-full px-4 py-4 text-left text-sm active:bg-accent flex items-center gap-3 border-b border-border touch-manipulation'
              data-track-category='XyneAI'
              data-track-name='RENAME_CONVERSATION'
              data-track-metadata={JSON.stringify({ conversationId: conversation.id })}
            >
              <XyneRename />
              <span>Rename</span>
            </button>
            <button
              onClick={e => {
                e.stopPropagation();
                onDelete();
                setOpenDropdownId(null);
              }}
              className='w-full px-4 py-4 text-left text-sm active:bg-accent flex items-center gap-3 text-red-600 touch-manipulation'
              data-track-category='XyneAI'
              data-track-name='DELETE_CONVERSATION'
              data-track-metadata={JSON.stringify({ conversationId: conversation.id })}
            >
              <XyneDelete />
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
              onToggleStar();
              setOpenDropdownId(null);
            }}
            className='w-full px-4 py-2 text-left text-sm hover:bg-accent flex items-center gap-2 border-b border-border'
            data-track-category='XyneAI'
            data-track-name='TOGGLE_STAR_DESKTOP'
            data-track-metadata={JSON.stringify({ conversationId: conversation.id })}
          >
            {isStarred || conversation.isStarred ? <XyneStarred /> : <XyneUnstarred />}
            <span>{isStarred || conversation.isStarred ? 'Unstar' : 'Star'}</span>
          </button>
          <button
            onClick={e => {
              e.stopPropagation();
              onStartRename();
              setOpenDropdownId(null);
            }}
            className='w-full px-4 py-2 text-left text-sm hover:bg-accent flex items-center gap-2 border-b border-border'
            data-track-category='XyneAI'
            data-track-name='RENAME_DESKTOP'
            data-track-metadata={JSON.stringify({ conversationId: conversation.id })}
          >
            <XyneRename />
            <span>Rename</span>
          </button>
          <button
            onClick={e => {
              e.stopPropagation();
              onDelete();
              setOpenDropdownId(null);
            }}
            className='w-full px-4 py-2 text-left text-sm hover:bg-accent flex items-center gap-2 text-red-600'
            data-track-category='XyneAI'
            data-track-name='DELETE_DESKTOP'
            data-track-metadata={JSON.stringify({ conversationId: conversation.id })}
          >
            <XyneDelete />
            <span>Delete</span>
          </button>
        </Popover>
      )}
    </div>
  );
};
