import { ReactElement, useState } from 'react';
import { ChevronDown, X, Star, Search, ArrowLeft, MoreVertical } from 'lucide-react';
import { Popover } from '../../../ui/Popover';
import type { ConversationHistory as ConversationHistoryType } from '../../../../utils/xyneAIStorage';
import { xyneAIActor } from '../../../../machines/xyneAIMachine';

interface ConversationHistoryProps {
  conversations: ConversationHistoryType[];
  conversationId: string;
  onBack: () => void;
  onLoadConversation: (conversation: ConversationHistoryType) => void;
  onToggleStar: (conversation: ConversationHistoryType) => Promise<void>;
  onDeleteConversation: (conversation: ConversationHistoryType) => Promise<void>;
  onRenameConversation: (conversation: ConversationHistoryType, newName: string) => Promise<void>;
}

export const ConversationHistory = ({
  conversations,
  conversationId,
  onBack,
  onLoadConversation,
  onToggleStar,
  onDeleteConversation,
  onRenameConversation,
}: ConversationHistoryProps): ReactElement => {
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
    <div className='flex-1 overflow-hidden flex flex-col bg-white'>
      {/* Header */}
      <div className='h-14 p-4 flex items-center justify-between gap-2 self-stretch border-gray-200'>
        {isSearchExpanded ? (
          <>
            <button
              onClick={() => {
                setIsSearchExpanded(false);
                setSearchQuery('');
              }}
              className='p-1 hover:bg-gray-100 rounded transition-colors flex-shrink-0'
            >
              <ArrowLeft className='w-5 h-5 text-gray-700' />
            </button>
            <div className='flex-1 flex items-center gap-2 bg-white rounded-lg border border-gray-300 px-3 py-2'>
              <input
                type='text'
                placeholder='Search chats...'
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="flex-1 bg-transparent outline-none text-gray-900 placeholder:text-gray-400 text-sm font-['Inter']"
              />
              <Search className='w-4 h-4 text-gray-600' />
            </div>
            <button
              onClick={handleClose}
              className='p-2 rounded-lg outline outline-1 outline-offset-[-1px] outline-gray-300 flex justify-center items-center gap-2.5 overflow-hidden hover:bg-gray-100 transition-colors'
            >
              <X className='w-4 h-4 text-gray-600' />
            </button>
          </>
        ) : (
          <>
            <div className='flex items-center gap-2'>
              <button onClick={onBack} className='p-1 hover:bg-gray-100 rounded transition-colors'>
                <ArrowLeft className='w-5 h-5 text-gray-700' />
              </button>
              <span className="text-gray-900 text-base font-semibold font-['Inter']">Chats</span>
            </div>
            <div className='flex items-center gap-2'>
              <button
                onClick={() => setIsSearchExpanded(true)}
                className='p-2 rounded-lg outline outline-1 outline-offset-[-1px] outline-gray-300 flex justify-center items-center gap-2.5 overflow-hidden hover:bg-gray-100 transition-colors'
              >
                <Search className='w-4 h-4 text-gray-600' />
              </button>
              <button
                onClick={handleClose}
                className='p-2 rounded-lg outline outline-1 outline-offset-[-1px] outline-gray-300 flex justify-center items-center gap-2.5 overflow-hidden hover:bg-gray-100 transition-colors'
              >
                <X className='w-4 h-4 text-gray-600' />
              </button>
            </div>
          </>
        )}
      </div>

      {/* Conversations List */}
      <div className='flex-1 overflow-y-auto'>
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
          emptyMessage={
            searchQuery
              ? `No chats found matching "${searchQuery}"`
              : 'No conversations yet. Start a new chat!'
          }
        />
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
  emptyMessage,
}: ConversationSectionProps): ReactElement => (
  <div className={title === 'Starred' ? 'border-b border-gray-200' : ''}>
    <details open>
      <summary className="px-4 py-2 cursor-pointer hover:bg-gray-50 flex items-center justify-between text-sm text-gray-600 font-medium font-['Inter']">
        <span>{title}</span>
        <ChevronDown className='w-4 h-4' />
      </summary>
      <div className='pb-2'>
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
            />
          ))}
        {conversations.length === 0 && emptyMessage && (
          <div className='px-4 py-8 text-center text-gray-500 text-sm'>{emptyMessage}</div>
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
  onLoad,
  onStartRename,
  onRename,
  onToggleStar,
  onDelete,
  setRenameValue,
  setRenamingId,
  setOpenDropdownId,
}: ConversationItemProps): ReactElement => (
  <div
    className={`relative w-full px-4 py-3 hover:bg-gray-50 transition-colors flex items-center gap-3 group ${
      isActive ? (isStarred ? 'bg-blue-50' : 'bg-blue-50 border-l-2 border-blue-500') : ''
    }`}
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
        className={`flex-1 text-sm text-gray-900 font-${isStarred ? 'medium' : 'normal'} font-["Inter"] border border-gray-300 rounded px-2 py-1 outline-none focus:border-primary`}
      />
    ) : (
      <button onClick={onLoad} className='flex-1 min-w-0 text-left'>
        <div
          className={`text-sm text-gray-900 font-${isStarred ? 'medium' : 'normal'} font-['Inter'] truncate`}
        >
          {conversation.title}
        </div>
      </button>
    )}
    <Popover
      open={isDropdownOpen}
      onOpenChange={open => setOpenDropdownId(open ? conversation.id : null)}
      align='end'
      sideOffset={4}
      trigger={
        <button
          onClick={e => e.stopPropagation()}
          className='opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-200 rounded'
        >
          <MoreVertical className='w-4 h-4 text-gray-600' />
        </button>
      }
      className='w-48 p-0 bg-white border border-gray-200 rounded-lg shadow-lg'
    >
      <button
        onClick={e => {
          e.stopPropagation();
          onToggleStar();
        }}
        className='w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2 border-b border-gray-100'
      >
        <Star
          className={`w-4 h-4 ${isStarred || conversation.isStarred ? 'fill-yellow-400 text-yellow-400' : 'text-gray-600'}`}
        />
        <span>{isStarred || conversation.isStarred ? 'Unstar' : 'Star'}</span>
      </button>
      <button
        onClick={e => {
          e.stopPropagation();
          onStartRename();
        }}
        className='w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2 border-b border-gray-100'
      >
        <svg
          xmlns='http://www.w3.org/2000/svg'
          width='16'
          height='16'
          viewBox='0 0 16 16'
          fill='none'
        >
          <g clipPath='url(#clip0_9048_7180)'>
            <path
              d='M8.66602 14H13.9993'
              stroke='black'
              strokeWidth='1.33333'
              strokeLinecap='round'
              strokeLinejoin='round'
            />
            <path
              d='M14.1166 4.54126C14.4691 4.18888 14.6671 3.71091 14.6672 3.2125C14.6673 2.71409 14.4693 2.23607 14.1169 1.8836C13.7646 1.53112 13.2866 1.33307 12.7882 1.33301C12.2898 1.33295 11.8117 1.53088 11.4593 1.88326L2.56194 10.7826C2.40715 10.9369 2.29268 11.127 2.22861 11.3359L1.34794 14.2373C1.33071 14.2949 1.32941 14.3562 1.34417 14.4145C1.35894 14.4728 1.38922 14.5261 1.4318 14.5686C1.47439 14.6111 1.52769 14.6413 1.58605 14.656C1.6444 14.6707 1.70565 14.6693 1.76327 14.6519L4.66527 13.7719C4.87405 13.7084 5.06406 13.5947 5.21861 13.4406L14.1166 4.54126Z'
              stroke='black'
              strokeWidth='1.33333'
              strokeLinecap='round'
              strokeLinejoin='round'
            />
          </g>
          <defs>
            <clipPath id='clip0_9048_7180'>
              <rect width='16' height='16' fill='white' />
            </clipPath>
          </defs>
        </svg>
        <span>Rename</span>
      </button>
      <button
        onClick={e => {
          e.stopPropagation();
          onDelete();
        }}
        className='w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2 text-red-600'
      >
        <svg
          xmlns='http://www.w3.org/2000/svg'
          width='16'
          height='16'
          viewBox='0 0 16 16'
          fill='none'
        >
          <path
            d='M12.6673 4V13.3333C12.6673 13.687 12.5268 14.0261 12.2768 14.2761C12.0267 14.5262 11.6876 14.6667 11.334 14.6667H4.66732C4.3137 14.6667 3.97456 14.5262 3.72451 14.2761C3.47446 14.0261 3.33398 13.687 3.33398 13.3333V4'
            stroke='#FF4F4F'
            strokeWidth='1.33333'
            strokeLinecap='round'
            strokeLinejoin='round'
          />
          <path
            d='M2 4H14'
            stroke='#FF4F4F'
            strokeWidth='1.33333'
            strokeLinecap='round'
            strokeLinejoin='round'
          />
          <path
            d='M5.33398 4.00016V2.66683C5.33398 2.31321 5.47446 1.97407 5.72451 1.72402C5.97456 1.47397 6.3137 1.3335 6.66732 1.3335H9.33398C9.68761 1.3335 10.0267 1.47397 10.2768 1.72402C10.5268 1.97407 10.6673 2.31321 10.6673 2.66683V4.00016'
            stroke='#FF4F4F'
            strokeWidth='1.33333'
            strokeLinecap='round'
            strokeLinejoin='round'
          />
        </svg>
        <span>Delete</span>
      </button>
    </Popover>
  </div>
);
