import { ReactElement, Fragment, MouseEvent as ReactMouseEvent } from 'react';
import { Command } from 'cmdk';
import { Eye } from 'lucide-react';
import {
  Hashtag,
  UserTwo,
  ChatDefault,
  EnvelopeDefault,
  TicketToken,
  File02Text,
  File02Default,
  MicOn,
  CheckTickSingle,
} from '@xyne/icons';
import { DisplaySearchResult } from '../../../types/search';
import { RenderMessageWithHTML } from '../RenderMessageWithHTML/RenderMessageWithHTML';
import UserAvatar from '../../UserAvatar/UserAvatar';
import Avatar from '../../ui/Avatar/Avatar';
import { SearchSnippetRenderer } from '../RenderMessageWithHTML/searchSnippetRender';
import { useUser } from '../../../hooks/useUsers';
import { isUserDeactivated, getUserDisplayName } from '../../../utils/userDisplayName';
import { StatusIndicator } from '../../ui/StatusIndicator';
import { StatusIndicator as TicketStatusIndicator } from '../../Board/StatusIndicator';
import { getPriorityIcon } from '../../Tickets/TicketCard/TicketCard.utils';
import { TicketPriority, TicketStatusV2 } from '@xyne/shared';

interface SearchResultItemProps {
  result: DisplaySearchResult;
  channelDisplayName?: string | undefined;
  /**
   * Channel the result belongs to, resolved by the parent against its existing
   * `allChannels` lookup (no per-row lookup here). `icon` is whatever the parent's
   * shared `getChannelIcon` returns — hashtag / lock / DM avatar — so the tag
   * follows the same public-vs-private logic as every other channel glyph.
   */
  channelTag?: { name: string; icon: ReactElement } | undefined;
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
  // Merge mode: shows checkboxes on desk email items instead of navigating
  mergeMode?: boolean | undefined;
  // Whether this item is selected for merge
  isMergeSelected?: boolean | undefined;
  // Called when an item is toggled in merge mode
  onToggleSelect?: ((result: DisplaySearchResult) => void) | undefined;
}

const getResultIcon = (result: DisplaySearchResult): ReactElement => {
  const { type, searchContext } = result;
  switch (type) {
    case 'user':
      return <UserTwo size={16} className='text-muted-foreground' />;
    case 'channel':
      return <Hashtag size={16} className='text-muted-foreground' />;
    case 'conversation':
      // Mail (Desk) results come back as 'conversation' with subApp='DESK'
      if (searchContext?.subApp === 'DESK') {
        return <EnvelopeDefault size={16} className='text-muted-foreground' />;
      }
      return <ChatDefault size={16} className='text-muted-foreground' />;
    case 'ticket':
      return <TicketToken size={16} className='text-muted-foreground' />;
    case 'attachment':
      if (searchContext?.subApp?.toUpperCase() === 'CANVAS') {
        return <File02Text size={16} className='text-muted-foreground' />;
      }
      if (searchContext?.subApp?.toUpperCase() === 'TRANSCRIPT') {
        return <MicOn size={16} className='text-muted-foreground' />;
      }
      return <File02Default size={16} className='text-muted-foreground' />;
    default:
      return <ChatDefault size={16} className='text-muted-foreground' />;
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
    <CheckTickSingle size={10} />
  </span>
);

// Second-line metadata row shared by ticket + file result cards. Renders a
// muted, single-line list of pre-filtered segments separated by a middot. The
// caller omits empty segments, so the separator never dangles. Uses only
// existing text / avatar / channel-tag constructs — no new icons.
const MetaLine = ({ segments }: { segments: ReactElement[] }): ReactElement | null => {
  if (segments.length === 0) return null;
  return (
    <div className='flex items-center gap-1.5 text-xs text-muted-foreground min-w-0 overflow-hidden'>
      {segments.map((seg, i) => (
        <Fragment key={i}>
          {i > 0 && <span className='shrink-0 text-muted-foreground/70'>·</span>}
          {seg}
        </Fragment>
      ))}
    </div>
  );
};


const asTicketStatusV2 = (status?: string): TicketStatusV2 | null => {
  const normalized = status?.toUpperCase();
  if (!normalized) return null;
  return (Object.values(TicketStatusV2) as string[]).includes(normalized)
    ? (normalized as TicketStatusV2)
    : null;
};

const asTicketPriority = (priority?: string): TicketPriority | null => {
  const normalized = priority?.toUpperCase();
  if (!normalized) return null;
  return (Object.values(TicketPriority) as string[]).includes(normalized)
    ? (normalized as TicketPriority)
    : null;
};

const TicketStatusSegment = ({ status }: { status?: string }): ReactElement | null => {
  if (!status) return null;
  const statusV2 = asTicketStatusV2(status);
  return (
    <span className='flex shrink-0 items-center gap-1 whitespace-nowrap'>
      {statusV2 && <TicketStatusIndicator status={statusV2} size={12} />}
      <span>{status}</span>
    </span>
  );
};

const TicketPrioritySegment = ({ priority }: { priority?: string }): ReactElement | null => {
  const ticketPriority = asTicketPriority(priority);
  if (!ticketPriority) return null;
  return (
    <span className='flex shrink-0 items-center gap-1 whitespace-nowrap'>
      <span className='flex h-3.5 w-3.5 shrink-0 items-center justify-center'>
        {getPriorityIcon(ticketPriority)}
      </span>
      <span>{priority}</span>
    </span>
  );
};

const TicketAssigneeSegment = ({
  assigneeId,
  assigneeName,
}: {
  assigneeId?: string | undefined;
  assigneeName?: string | undefined;
}): ReactElement => {
  if (!assigneeId && !assigneeName) {
    return (
      <span className='flex min-w-0 items-center gap-1'>
        <span className='flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-dashed border-muted-foreground/60' />
        <span className='truncate'>Unassigned</span>
      </span>
    );
  }

  return (
    <span className='flex min-w-0 items-center gap-1'>
      {assigneeId && <Avatar userId={assigneeId} size='xs' />}
      <span className='truncate'>{assigneeName || 'Unassigned'}</span>
    </span>
  );
};

const AttachmentSearchResultItem = ({
  result,
  channelTag,
  onSelect,
  onPreview,
  isSelected,
  onItemMouseDown,
}: {
  result: DisplaySearchResult;
  channelTag?: { name: string; icon: ReactElement } | undefined;
  onSelect: (result: DisplaySearchResult) => Promise<void> | void;
  onPreview?: ((result: DisplaySearchResult) => void) | undefined;
  isSelected: boolean;
  onItemMouseDown?: ((e: ReactMouseEvent, result: DisplaySearchResult) => void) | undefined;
}): ReactElement => {
  // `result.avatar` carries the file's ownerId (see transformFile in the backend
  // resultTransform); resolve it to a display name via the same user store the
  // rest of Cmd+K uses.
  const uploaderId = result.avatar;
  const uploader = useUser(uploaderId || '');
  const handleMouseDown = onItemMouseDown
    ? (e: ReactMouseEvent) => onItemMouseDown(e, result)
    : undefined;

  const rawTs = result.metadata.timestamp;
  const createdAt = rawTs && rawTs !== 'N/A' ? utcToIst(rawTs) : '';

  const uploaderName = uploader ? getUserDisplayName(uploader) : '';
  const shouldShowUploader = !!uploaderId && !!uploader && uploaderName !== 'Unknown';

  const metaSegments: ReactElement[] = [];
  if (shouldShowUploader) {
    metaSegments.push(
      <span key='uploader' className='flex min-w-0 items-center gap-1'>
        <Avatar userId={uploaderId} size='xs' />
        <span className='truncate'>{uploaderName}</span>
      </span>,
    );
  }
  if (channelTag) {
    metaSegments.push(
      <span key='channel' className='flex min-w-0 items-center gap-1'>
        <span className='flex h-3.5 w-3.5 shrink-0 items-center justify-center'>
          {channelTag.icon}
        </span>
        <span className='truncate'>{channelTag.name}</span>
      </span>,
    );
  }

  return (
    <Command.Item
      key={result.id}
      value={`backend-${result.type}-${result.id}`}
      data-result-id={result.id}
      data-result-type={result.type}
      data-item-label={(result.title || '').replace(/<[^>]*>/g, '')}
      onSelect={() => void onSelect(result)}
      onMouseDownCapture={handleMouseDown}
      className='flex w-full items-center gap-3 p-3 rounded-lg cursor-pointer hover:bg-accent aria-selected:bg-accent mt-1.5'
    >
      <span className='flex shrink-0 items-center'>{getResultIcon(result)}</span>
      <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
        <span className='min-w-0 *:truncate text-[15px] leading-[1.2] tracking-[-0.1px] text-foreground'>
          <RenderMessageWithHTML message={result.title} />
        </span>
        <div className='flex min-w-0 items-center justify-between gap-2'>
          <MetaLine segments={metaSegments} />
          {createdAt && (
            <span className='shrink-0 whitespace-nowrap text-xs text-muted-foreground'>
              {createdAt}
            </span>
          )}
        </div>
      </div>
      {isSelected && <SelectedBadge />}
      {!isSelected &&
        onPreview &&
        result.searchContext?.internalUrl &&
        result.searchContext?.subApp?.toUpperCase() !== 'TRANSCRIPT' && (
          <button
            onClick={e => {
              e.stopPropagation();
              onPreview(result);
            }}
            className='p-1.5 text-muted-foreground hover:text-accent-foreground hover:bg-accent rounded transition-colors focus-visible:outline-none focus-visible:ring-0'
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
};

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
      data-item-label={result.title}
      onSelect={() => void onSelect(result)}
      onMouseDownCapture={handleMouseDown}
      className='flex items-center gap-3 p-3 rounded-lg cursor-pointer hover:bg-accent aria-selected:bg-accent mt-1.5'
    >
      <Avatar userId={result.id} size='xs' />
      <div className='flex-1 min-w-0 flex items-center gap-2'>
        <span
          className={`min-w-0 truncate text-[15px] leading-[1.2] tracking-[-0.1px] ${isDeactivated ? 'text-muted-foreground' : 'text-foreground'}`}
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
          <span className='shrink-0 text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded'>
            Deactivated
          </span>
        )}
        {result.subtitle && (
          <span className='min-w-0 truncate text-xs text-muted-foreground'>{result.subtitle}</span>
        )}
      </div>
      {isSelected && <SelectedBadge />}
    </Command.Item>
  );
};

const SearchResultItem = ({
  result,
  channelTag,
  onSelect,
  onPreview,
  isSelected = false,
  onItemMouseDown,
  onItemMouseEnter,
  onItemMouseLeave,
  mergeMode = false,
  isMergeSelected = false,
  onToggleSelect,
}: SearchResultItemProps): ReactElement => {
  const handleMouseDown =
    onItemMouseDown && !mergeMode ? (e: ReactMouseEvent) => onItemMouseDown(e, result) : undefined;

  const handleMouseEnter = onItemMouseEnter ? () => onItemMouseEnter(result) : undefined;
  const handleMouseLeave = onItemMouseLeave || undefined;

  // Plain-text title for the Cmd+K data-item-label; strip <hi> tags (regex, not a
  // DOM parser, since it runs per result row per keystroke).
  const itemLabel = (result.title || '').replace(/<[^>]*>/g, '');

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
        const deskTicketSubtitle = [
          result.subtitle || result.searchContext.xyneId,
          ...(result.searchContext.formFieldMatches ?? []).map(
            field => `${field.fieldName ?? field.fieldId}: ${field.fieldValue}`,
          ),
        ]
          .filter(Boolean)
          .join(' | ');
        return (
          <Command.Item
            key={result.id}
            value={`backend-${result.type}-${result.id}`}
            data-result-id={result.id}
            data-result-type={result.type}
            data-ticket-id={result.searchContext?.ticketId || ''}
            onSelect={() => {
              if (mergeMode && onToggleSelect) {
                onToggleSelect(result);
              } else {
                void onSelect(result);
              }
            }}
            onMouseDownCapture={handleMouseDown}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            className='flex flex-col gap-0.5 p-3 rounded-lg cursor-pointer hover:bg-accent aria-selected:bg-accent mt-1.5'
          >
            <div className='flex items-start gap-1.5'>
              {mergeMode && (
                <div className='flex items-center justify-center h-4 w-5 flex-shrink-0 mt-0.5'>
                  {isMergeSelected ? (
                    <span className='flex-shrink-0 flex items-center justify-center w-4 h-4 rounded-full bg-primary text-primary-foreground'>
                      <CheckTickSingle size={10} />
                    </span>
                  ) : (
                    <span className='w-4 h-4 rounded border border-muted-foreground/30 flex-shrink-0' />
                  )}
                </div>
              )}
              {getResultIcon(result)}
              <div className='flex-1 min-w-0'>
                {/* Line 1: subject gets the full row */}
                <div className='flex items-baseline gap-1 text-[15px] leading-[1.2] tracking-[-0.1px] text-foreground'>
                  <div className='min-w-0 truncate'>
                    <RenderMessageWithHTML message={result.title} />
                  </div>
                </div>
                {/* Line 2: ticket ID and matched form fields, ticket-subtitle style */}
                {deskTicketSubtitle && (
                  <div className='text-xs text-foreground truncate'>
                    <RenderMessageWithHTML message={deskTicketSubtitle} />
                  </div>
                )}
                {/* Line 3: sender on the left, timestamp on the right */}
                <div className='flex items-center justify-between gap-2 text-xs text-muted-foreground'>
                  <span className='min-w-0 truncate'>
                    {senderName}
                    {recipientCount > 0 && ` +${recipientCount} more`}
                  </span>
                  <span className='whitespace-nowrap shrink-0'>
                    {utcToIst(result.metadata.timestamp)}
                  </span>
                </div>
              </div>
              {!mergeMode && isSelected && <SelectedBadge />}
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
          data-item-label={itemLabel}
          onSelect={() => void onSelect(result)}
          onMouseDownCapture={handleMouseDown}
          className='flex flex-col gap-0.5 p-3 rounded-lg cursor-pointer hover:bg-accent aria-selected:bg-accent mt-1.5'
        >
          <div className='flex items-center gap-1.5'>
            {result.avatar ? <UserAvatar userId={result.avatar} /> : getResultIcon(result)}
            <div className='flex-1 min-w-0'>
              <div className='flex items-center gap-1.5 text-sm'>
                <span className='font-medium text-foreground truncate'>
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

    case 'ticket': {
      // Line 1: icon | ticketId | · | title. Line 2 (MetaLine): created · channel
      // · status · priority · assigned-to. Only the title / channel / assignee
      // truncate; every field reuses an existing construct (no new icons).
      const ticketId = result.searchContext?.xyneId;
      const rawTs = result.metadata.timestamp;
      const createdAt = rawTs && rawTs !== 'N/A' ? utcToIst(rawTs) : '';
      const status = result.searchContext?.ticketStatus;
      const priority = result.searchContext?.priority;
      const assigneeId = result.searchContext?.assignedTo;
      const assigneeName = result.searchContext?.assigneeName;

      const metaSegments: ReactElement[] = [];
      if (channelTag) {
        metaSegments.push(
          <span key='channel' className='flex min-w-0 items-center gap-1'>
            <span className='flex h-3.5 w-3.5 shrink-0 items-center justify-center'>
              {channelTag.icon}
            </span>
            <span className='truncate'>{channelTag.name}</span>
          </span>,
        );
      }
      if (status) {
        metaSegments.push(<TicketStatusSegment key='status' status={status} />);
      }
      if (priority) {
        metaSegments.push(<TicketPrioritySegment key='priority' priority={priority} />);
      }
      metaSegments.push(
        <TicketAssigneeSegment
          key='assignee'
          assigneeId={assigneeId}
          assigneeName={assigneeName}
        />,
      );

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
          className='flex w-full items-center gap-3 p-3 rounded-lg cursor-pointer hover:bg-accent aria-selected:bg-accent mt-1.5'
        >
          <span className='flex shrink-0 items-center'>{getResultIcon(result)}</span>
          <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
            <div className='flex items-center gap-1.5 min-w-0'>
              {ticketId && (
                <>
                  <span className='shrink-0 whitespace-nowrap text-[15px] leading-[1.2] tracking-[-0.1px] text-muted-foreground'>
                    {ticketId}
                  </span>
                  <span className='shrink-0 text-[14px] font-medium leading-[1.2] tracking-[-0.28px] text-muted-foreground'>
                    ·
                  </span>
                </>
              )}
              <span className='min-w-0 *:truncate text-[15px] leading-[1.2] tracking-[-0.1px] text-foreground'>
                <RenderMessageWithHTML message={result.title} />
              </span>
            </div>
            <div className='flex min-w-0 items-center justify-between gap-2'>
              <MetaLine segments={metaSegments} />
              {createdAt && (
                <span className='shrink-0 whitespace-nowrap text-xs text-muted-foreground'>
                  {createdAt}
                </span>
              )}
            </div>
          </div>
          {isSelected && <SelectedBadge />}
        </Command.Item>
      );
    }

    case 'attachment':
      return (
        <AttachmentSearchResultItem
          result={result}
          channelTag={channelTag}
          onSelect={onSelect}
          onPreview={onPreview}
          isSelected={isSelected}
          onItemMouseDown={onItemMouseDown}
        />
      );

    default:
      return (
        <Command.Item
          key={result.id}
          value={`backend-${result.type}-${result.id}`}
          data-result-id={result.id}
          data-result-type={result.type}
          data-item-label={itemLabel}
          onSelect={() => void onSelect(result)}
          onMouseDownCapture={handleMouseDown}
          className='flex items-center gap-3 p-3 rounded-lg cursor-pointer hover:bg-accent aria-selected:bg-accent mt-1.5'
        >
          {getResultIcon(result)}
          <div className='flex-1 min-w-0'>
            <div className='text-[15px] leading-[1.2] tracking-[-0.1px] text-foreground truncate'>
              {result.title}
            </div>
            <div className='text-xs text-muted-foreground'>{result.subtitle}</div>
          </div>
          {isSelected && <SelectedBadge />}
        </Command.Item>
      );
  }
};

export default SearchResultItem;
