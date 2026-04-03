import { ReactElement } from 'react';
import { Command } from 'cmdk';
import {
  Hash,
  User,
  MessageCircle,
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

interface SearchResultItemProps {
  result: DisplaySearchResult;
  onSelect: (result: DisplaySearchResult) => Promise<void> | void;
  onPreview?: (result: DisplaySearchResult) => void;
  isSelected?: boolean;
}

const getResultIcon = (result: DisplaySearchResult): ReactElement => {
  const { type, searchContext } = result;
  switch (type) {
    case 'user':
      return <User size={16} className='text-muted-foreground' />;
    case 'channel':
      return <Hash size={16} className='text-muted-foreground' />;
    case 'conversation':
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
  <span className='flex-shrink-0 flex items-center justify-center w-4 h-4 rounded-full bg-primary text-white'>
    <Check size={10} />
  </span>
);

const SearchResultItem = ({
  result,
  onSelect,
  onPreview,
  isSelected = false,
}: SearchResultItemProps): ReactElement => {
  switch (result.type) {
    case 'user':
      return (
        <Command.Item
          key={result.id}
          value={`backend-${result.type}-${result.id}`}
          onSelect={() => void onSelect(result)}
          className='flex items-center gap-2 px-2 py-1.5 rounded-sm cursor-pointer hover:bg-accent aria-selected:bg-accent mt-1'
        >
          <Avatar userId={result.id} size='sm' />
          <div className='flex-1 min-w-0'>
            <div className='font-semibold text-xs text-foreground truncate'>{result.title}</div>
            <div className='text-[11px] text-muted-foreground'>{result.subtitle}</div>
          </div>
          {isSelected && <SelectedBadge />}
        </Command.Item>
      );

    case 'conversation': {
      // Use scopeType to determine channel type instead of parsing title
      const scopeType = result.searchContext?.scopeType;
      const isDmOrGroupDm = scopeType === 'DM' || scopeType === 'GROUP_DM';
      const preposition = isDmOrGroupDm ? 'with' : 'in';

      return (
        <Command.Item
          key={result.id}
          value={`backend-${result.type}-${result.id}`}
          onSelect={() => void onSelect(result)}
          className='flex flex-col gap-0.5 px-2 py-1.5 rounded-sm cursor-pointer hover:bg-accent aria-selected:bg-accent mt-1'
        >
          <div className='flex items-center gap-1.5'>
            {result.avatar ? <UserAvatar userId={result.avatar} /> : getResultIcon(result)}
            <div className='flex-1 min-w-0'>
              <div className='flex items-center gap-1.5 text-xs'>
                <span className='font-semibold text-foreground truncate'>
                  {result.searchContext?.senderName}
                </span>
                <span className='text-[10px] text-muted-foreground'>{preposition}</span>
                <span className='text-[10px] font-medium text-foreground truncate'>
                  {result.title}
                </span>
                <span className='text-[10px] text-muted-foreground'>
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

    case 'ticket':
      return (
        <Command.Item
          key={result.id}
          value={`backend-${result.type}-${result.id}`}
          onSelect={() => void onSelect(result)}
          className='flex flex-col gap-2 px-2 py-1.5 rounded-sm cursor-pointer hover:bg-accent aria-selected:bg-accent mt-1'
        >
          <div className='flex items-center gap-2'>
            {getResultIcon(result)}
            <div className='flex-1 min-w-0'>
              <div className='font-semibold text-xs text-foreground truncate'>
                <RenderMessageWithHTML message={result.title} />
              </div>
              {result.subtitle && (
                <div className='text-[11px] text-muted-foreground line-clamp-2'>
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
          onSelect={() => void onSelect(result)}
          className='flex items-center gap-2 px-2 py-1.5 rounded-sm cursor-pointer hover:bg-accent aria-selected:bg-accent mt-1'
        >
          {getResultIcon(result)}
          <div className='flex-1 min-w-0'>
            <div className='font-semibold text-xs text-foreground truncate'>
              {' '}
              <RenderMessageWithHTML message={result.title} />
            </div>
            <div className='text-[11px] text-muted-foreground'>
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
                className='p-1.5 text-gray-500 hover:text-black-700 hover:bg-gray-200 rounded transition-colors'
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
          onSelect={() => void onSelect(result)}
          className='flex items-center gap-2 px-2 py-1.5 rounded-sm cursor-pointer hover:bg-accent aria-selected:bg-accent mt-1'
        >
          {getResultIcon(result)}
          <div className='flex-1 min-w-0'>
            <div className='font-semibold text-xs text-foreground truncate'>{result.title}</div>
            <div className='text-[11px] text-muted-foreground'>{result.subtitle}</div>
          </div>
          {isSelected && <SelectedBadge />}
        </Command.Item>
      );
  }
};

export default SearchResultItem;
