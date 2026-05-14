import { ReactElement, MouseEvent as ReactMouseEvent } from 'react';
import { Command } from 'cmdk';
import {
  Hash,
  User,
  MessageCircle,
  Mail,
  Ticket,
  Paperclip,
  Eye,
  FileText,
  Mic,
  Check,
} from 'lucide-react';
import { DisplaySearchResult } from '../../../types/search';
import { RenderMessageWithHTML } from '../RenderMessageWithHTML/RenderMessageWithHTML';
import UserAvatar from '../../UserAvatar/UserAvatar';
import Avatar from '../../ui/Avatar/Avatar';
import { SearchSnippetRenderer } from '../RenderMessageWithHTML/searchSnippetRender';
import { useUser } from '../../../hooks/useUsers';
import { isUserDeactivated } from '../../../utils/userDisplayName';
import { StatusIndicator } from '../../ui/StatusIndicator';

interface SearchResultItemProps {
  result: DisplaySearchResult;
  onSelect: (result: DisplaySearchResult) => Promise<void> | void;
  onPreview?: (result: DisplaySearchResult) => void;
  isSelected?: boolean;
  // Fires on mousedown before cmdk's click->onSelect chain so callers can
  // capture the modifier state of the gesture (cmdk's onSelect drops the event).
  onItemMouseDown?: (e: ReactMouseEvent, result: DisplaySearchResult) => void;
  // Fires on mouse enter to show preview (Linear-style).
  onItemMouseEnter?: (result: DisplaySearchResult) => void;
  // Fires on mouse leave to clear hover state.
  onItemMouseLeave?: () => void;
}

const getResultIcon = (result: DisplaySearchResult): ReactElement => {
  const { type, searchContext } = result;
  switch (type) {
    case 'user':
      return <User size={16} className='text-muted-foreground' />;
    case 'channel':
      return <Hash size={16} className='text-muted-foreground' />;
    case 'conversation':
      // Mail (Desk) results come back as 'conversation' with subApp='DESK'
      if (searchContext?.subApp === 'DESK') {
        return <Mail size={16} className='text-muted-foreground' />;
      }
      return <MessageCircle size={16} className='text-muted-foreground' />;
    case 'ticket':
      return <Ticket size={16} className='text-muted-foreground' />;
    case 'attachment':
      if (searchContext?.subApp === 'canvas') {
        return <FileText size={16} className='text-muted-foreground' />;
      }
      if (searchContext?.subApp === 'transcript') {
        return <Mic size={16} className='text-muted-foreground' />;
      }
      return <Paperclip size={16} className='text-muted-foreground' />;
    default:
      return <MessageCircle size={16} className='text-muted-foreground' />;
  }
};

const utcToIst = (utcString?: string): string => {
  if (!utcString) return '';

  const dateUtc = new Date(`${utcString} UTC`);

  return dateUtc.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
};

const SelectedBadge = (): ReactElement => (
  <span className='flex-shrink-0 flex items-center justify-center w-4 h-4 rounded-full bg-primary text-primary-foreground'>
    <Check size={10} />
  </span>
);

const UserSearchResultItem = ({
  result,
  onSelect,
  isSelected,
  onItemMouseDown,
}: {
  result: DisplaySearchResult;
  onSelect: (result: DisplaySearchResult) => Promise<void> | void;
  isSelected: boolean;
  onItemMouseDown?: ((e: ReactMouseEvent, result: DisplaySearchResult) => void) | undefined;
}): ReactElement => {
  const user = useUser(result.id);
  const isDeactivated = isUserDeactivated(user);
  const handleMouseDown = onItemMouseDown
    ? (e: ReactMouseEvent) => onItemMouseDown(e, result)
    : undefined;

  return (
    <Command.Item
      key={result.id}
      value={`backend-${result.type}-${result.id}`}
      data-result-id={result.id}
      data-result-type={result.type}
      onSelect={() => void onSelect(result)}
      onMouseDownCapture={handleMouseDown}
      className='flex items-center gap-2 px-2 py-1.5 rounded-sm cursor-pointer hover:bg-accent aria-selected:bg-accent mt-1'
    >
      <Avatar userId={result.id} size='sm' />
      <div className='flex-1 min-w-0'>
        <div className='flex items-center gap-2'>
          <span
            className={`font-semibold text-sm truncate ${isDeactivated ? 'text-muted-foreground' : 'text-foreground'}`}
          >
            {result.title}
          </span>
          {!isDeactivated && (user?.statusEmoji || user?.statusContent) && (
            <StatusIndicator
              statusEmoji={user?.statusEmoji}
              statusContent={user?.statusContent}
              statusExpiryAt={user?.statusExpiryAt}
              size='sm'
            />
          )}
          {isDeactivated && (
            <span className='text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0'>
              Deactivated
            </span>
          )}
        </div>
        <div className='text-xs text-muted-foreground'>{result.subtitle}</div>
      </div>
      {isSelected && <SelectedBadge />}
    </Command.Item>
  );
};

const SearchResultItem = ({
  result,
  onSelect,
  onPreview,
  isSelected = false,
  onItemMouseDown,
  onItemMouseEnter,
  onItemMouseLeave,
}: SearchResultItemProps): ReactElement => {
  const handleMouseDown = onItemMouseDown
    ? (e: ReactMouseEvent) => onItemMouseDown(e, result)
    : undefined;

  const handleMouseEnter = onItemMouseEnter ? () => onItemMouseEnter(result) : undefined;
  const handleMouseLeave = onItemMouseLeave || undefined;

  switch (result.type) {
    case 'user':
      return (
        <UserSearchResultItem
          result={result}
          onSelect={onSelect}
          isSelected={isSelected}
          onItemMouseDown={onItemMouseDown}
        />
      );

    case 'conversation': {
      // Mail results come back as type='conversation' with subApp='DESK'.
      // They render in a distinct layout: subject (highlighted) + date on the
      // first line, sender name + recipient count on the second, body snippet
      // on the third. The subject goes through RenderMessageWithHTML so any
      // <hi>...</hi> spans from Vespa turn into yellow highlights.
      if (result.searchContext?.subApp === 'DESK') {
        const senderName = result.searchContext?.senderName || result.subtitle || '';
        const recipientCount = result.searchContext?.recipientCount ?? 0;
        return (
          <Command.Item
            key={result.id}
            value={`backend-${result.type}-${result.id}`}
            data-result-id={result.id}
            data-result-type={result.type}
            onSelect={() => void onSelect(result)}
            className='flex flex-col gap-0.5 px-2 py-1.5 rounded-sm cursor-pointer hover:bg-accent aria-selected:bg-accent mt-1'
          >
            <div className='flex items-start gap-1.5'>
              {getResultIcon(result)}
              <div className='flex-1 min-w-0'>
                {/* Line 1: subject gets the full row */}
                <div className='font-semibold text-xs text-foreground truncate'>
                  <RenderMessageWithHTML message={result.title} />
                </div>
                {/* Line 2: sender on the left, timestamp aligned on the right */}
                <div className='flex items-center justify-between gap-2 text-[11px] text-muted-foreground'>
                  <span className='min-w-0 truncate'>
                    {senderName}
                    {recipientCount > 0 && ` +${recipientCount} more`}
                  </span>
                  <span className='shrink-0 whitespace-nowrap'>
                    {utcToIst(result.metadata.timestamp)}
                  </span>
                </div>
              </div>
              {isSelected && <SelectedBadge />}
            </div>
            <div className='pl-6 text-xs text-foreground'>
              <SearchSnippetRenderer message={result.context || ''} wordLimit={40} />
            </div>
          </Command.Item>
        );
      }

      // Use scopeType to determine channel type instead of parsing title
      const scopeType = result.searchContext?.scopeType;
      const isDmOrGroupDm = scopeType === 'DM' || scopeType === 'GROUP_DM';
      const preposition = isDmOrGroupDm ? 'with' : 'in';

      return (
        <Command.Item
          key={result.id}
          value={`backend-${result.type}-${result.id}`}
          data-result-id={result.id}
          data-result-type={result.type}
          onSelect={() => void onSelect(result)}
          onMouseDownCapture={handleMouseDown}
          className='flex flex-col gap-0.5 px-2 py-1.5 rounded-sm cursor-pointer hover:bg-accent aria-selected:bg-accent mt-1'
        >
          <div className='flex items-center gap-1.5'>
            {result.avatar ? <UserAvatar userId={result.avatar} /> : getResultIcon(result)}
            <div className='flex-1 min-w-0'>
              <div className='flex items-center gap-1.5 text-sm'>
                <span className='font-semibold text-foreground truncate'>
                  {result.searchContext?.senderName}
                </span>
                <span className='text-xs text-muted-foreground'>{preposition}</span>
                <span className='text-xs font-medium text-foreground truncate'>{result.title}</span>
                <span className='text-xs text-muted-foreground'>
                  {utcToIst(result.metadata.timestamp)}
                </span>
              </div>
            </div>
            {isSelected && <SelectedBadge />}
          </div>
          <div className='pl-6 text-sm text-foreground'>
            <SearchSnippetRenderer message={result.context || ''} wordLimit={40} />
          </div>
        </Command.Item>
      );
    }

    case 'ticket':
      return (
        <Command.Item
          key={result.id}
          value={`backend-${result.type}-${result.id}`}
          data-result-id={result.id}
          data-result-type={result.type}
          data-ticket-id={result.id}
          onSelect={() => void onSelect(result)}
          onMouseDownCapture={handleMouseDown}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          className='group flex flex-col gap-2 px-2 py-1.5 rounded-sm cursor-pointer hover:bg-accent aria-selected:bg-accent mt-1'
        >
          <div className='flex items-center gap-2'>
            {getResultIcon(result)}
            <div className='flex-1 min-w-0'>
              <div className='font-semibold text-sm text-foreground truncate'>
                <RenderMessageWithHTML message={result.title} />
              </div>
              {result.subtitle && (
                <div className='text-xs text-muted-foreground line-clamp-2'>
                  <RenderMessageWithHTML message={result.subtitle} />
                </div>
              )}
            </div>
            {isSelected && <SelectedBadge />}
          </div>
        </Command.Item>
      );

    case 'attachment':
      return (
        <Command.Item
          key={result.id}
          value={`backend-${result.type}-${result.id}`}
          data-result-id={result.id}
          data-result-type={result.type}
          onSelect={() => void onSelect(result)}
          onMouseDownCapture={handleMouseDown}
          className='flex items-center gap-2 px-2 py-1.5 rounded-sm cursor-pointer hover:bg-accent aria-selected:bg-accent mt-1'
        >
          {getResultIcon(result)}
          <div className='flex-1 min-w-0'>
            <div className='font-semibold text-sm text-foreground truncate'>
              {' '}
              <RenderMessageWithHTML message={result.title} />
            </div>
            <div className='text-xs text-muted-foreground'>
              {' '}
              <RenderMessageWithHTML message={result.subtitle} />
            </div>
          </div>
          {isSelected && <SelectedBadge />}
          {!isSelected &&
            onPreview &&
            result.searchContext?.internalUrl &&
            result.searchContext?.subApp !== 'transcript' && (
              <button
                onClick={e => {
                  e.stopPropagation();
                  onPreview(result);
                }}
                className='p-1.5 text-muted-foreground hover:text-accent-foreground hover:bg-accent rounded transition-colors'
                title='Preview file'
                data-track-category='GLOBAL_SEARCH'
                data-track-name='PREVIEW_SEARCH_RESULT'
                data-track-metadata={JSON.stringify({
                  resultId: result.id,
                  resultType: result.type,
                })}
              >
                <Eye size={14} />
              </button>
            )}
        </Command.Item>
      );

    default:
      return (
        <Command.Item
          key={result.id}
          value={`backend-${result.type}-${result.id}`}
          data-result-id={result.id}
          data-result-type={result.type}
          onSelect={() => void onSelect(result)}
          onMouseDownCapture={handleMouseDown}
          className='flex items-center gap-2 px-2 py-1.5 rounded-sm cursor-pointer hover:bg-accent aria-selected:bg-accent mt-1'
        >
          {getResultIcon(result)}
          <div className='flex-1 min-w-0'>
            <div className='font-semibold text-sm text-foreground truncate'>{result.title}</div>
            <div className='text-xs text-muted-foreground'>{result.subtitle}</div>
          </div>
          {isSelected && <SelectedBadge />}
        </Command.Item>
      );
  }
};

export default SearchResultItem;
