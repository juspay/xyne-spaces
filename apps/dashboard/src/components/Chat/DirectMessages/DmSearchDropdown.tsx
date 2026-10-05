import { memo, useEffect, useMemo, useRef, type ReactElement } from 'react';
import type { Channel, User } from '@xyne/shared';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { cn } from '../../../utils/classNames';
import Avatar from '../../ui/Avatar/Avatar';
import { StatusIndicator } from '../../ui/StatusIndicator';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { useChannelDisplayName } from '../../../hooks/useChannelDisplayName';
import type { DmPersonResult } from '../../../hooks/useDmsSearch';

const DM_SEARCH_ROW_CLASS =
  'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-foreground/[6%]';

const GROUPS_HEADER_ID = '__group-dms-header__';

// Roughly one py-1.5 single-line row; only used to size the virtualized scroller.
const ROW_HEIGHT = 36;
const MAX_HEIGHT = 320;
const VIRTUALIZE_THRESHOLD = 30;

type SearchItem =
  | { type: 'person'; person: DmPersonResult }
  | { type: 'groupsHeader' }
  | { type: 'group'; channel: Channel };

const getItemKey = (item: SearchItem): string =>
  item.type === 'person'
    ? `person:${item.person.user.id}`
    : item.type === 'groupsHeader'
      ? GROUPS_HEADER_ID
      : `group:${item.channel.id}`;

const DmSearchResultItem = ({ channel }: { channel: Channel }): ReactElement => {
  const context = useAuthContextValues();
  const { displayName, avatarUserId } = useChannelDisplayName(channel, context.userID);

  return (
    <>
      <Avatar userId={avatarUserId} size='rg' showActiveStatus={false} className='shrink-0' />
      <span className='min-w-0 flex-1 truncate'>{displayName}</span>
    </>
  );
};

interface DmUserSearchResultItemProps {
  user: User;
  isCurrentUser?: boolean;
}

const DmUserSearchResultItem = ({
  user,
  isCurrentUser,
}: DmUserSearchResultItemProps): ReactElement => {
  return (
    <>
      <Avatar userId={user.id} size='rg' className='shrink-0' />
      <span className='min-w-0 truncate'>
        {getUserDisplayName(user)}
        {isCurrentUser ? ' (you)' : ''}
      </span>
      {(user.activityStatus || user.statusEmoji || user.statusContent) && (
        <StatusIndicator
          statusEmoji={user.statusEmoji}
          statusContent={user.statusContent}
          statusExpiryAt={user.statusExpiryAt}
          activityStatus={user.activityStatus}
          size='sm'
        />
      )}
    </>
  );
};

interface DmSearchDropdownProps {
  isVisible: boolean;
  peopleResults: DmPersonResult[];
  groupDmResults: Channel[];
  /** Combined selection index over people then groups (same scheme as the key handler). */
  selectedIndex: number;
  /** True while deferred results lag the typed query: suppress the no-results flash. */
  isStale: boolean;
  queryLength: number;
  /** Pre-computed analytics count (the page's filtered DM list length). */
  trackedResultCount: number;
  currentUserId: string;
  onSelectChannel: (channelId: string) => void;
  onSelectUser: (userId: string) => void;
}

const DmSearchDropdownComponent = ({
  isVisible,
  peopleResults,
  groupDmResults,
  selectedIndex,
  isStale,
  queryLength,
  trackedResultCount,
  currentUserId,
  onSelectChannel,
  onSelectUser,
}: DmSearchDropdownProps): ReactElement | null => {
  const items = useMemo<SearchItem[]>(() => {
    const out: SearchItem[] = peopleResults.map(person => ({ type: 'person', person }));
    if (groupDmResults.length > 0) {
      out.push({ type: 'groupsHeader' });
      for (const channel of groupDmResults) out.push({ type: 'group', channel });
    }
    return out;
  }, [peopleResults, groupDmResults]);

  // Header row is visual-only: keyboard indices skip it, so the visual highlight index
  // shifts by one for group rows. peopleCount selectable rows come first.
  const highlightVisualIndex =
    selectedIndex >= peopleResults.length && groupDmResults.length > 0
      ? selectedIndex + 1
      : selectedIndex;

  const isVirtualized = items.length > VIRTUALIZE_THRESHOLD;
  const virtualizedHeight = Math.min(items.length * ROW_HEIGHT, MAX_HEIGHT);

  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const plainListRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (highlightVisualIndex < 0 || !isVisible) return;
    if (isVirtualized) {
      virtuosoRef.current?.scrollToIndex({ index: highlightVisualIndex, align: 'center' });
      return;
    }
    const el = plainListRef.current?.children[highlightVisualIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlightVisualIndex, isVirtualized, isVisible]);

  if (!isVisible) return null;

  const noResults = items.length === 0;
  // While deferred results lag the typed query, don't flash "No results found".
  const showNoResults = noResults && !isStale;

  const renderItem = (item: SearchItem, visualIndex: number): ReactElement => {
    if (item.type === 'groupsHeader') {
      return (
        <>
          {peopleResults.length > 0 && <div className='my-1 h-px bg-border' />}
          <div className='px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground'>
            Group DMs
          </div>
        </>
      );
    }
    if (item.type === 'person') {
      const person = item.person;
      const personChannelId = person.channelId;
      return (
        <button
          type='button'
          className={cn(DM_SEARCH_ROW_CLASS, visualIndex === selectedIndex && 'bg-foreground/[6%]')}
          onClick={() =>
            personChannelId ? void onSelectChannel(personChannelId) : onSelectUser(person.user.id)
          }
          data-track-category='DM'
          data-track-name={personChannelId ? 'SELECT_DM_SEARCH_RESULT' : 'SELECT_NEW_DM_USER'}
          data-track-metadata={JSON.stringify({
            channelId: personChannelId,
            resultCount: trackedResultCount,
            queryLength,
          })}
        >
          <DmUserSearchResultItem
            user={person.user}
            isCurrentUser={person.user.id === currentUserId}
          />
        </button>
      );
    }
    // group: groups sit one visual slot after the people rows (header takes the slot), which
    // keyboard indices skip — so the row's selectable index is one behind its visual index.
    const keyboardIndex = visualIndex - 1;
    return (
      <button
        type='button'
        className={cn(DM_SEARCH_ROW_CLASS, keyboardIndex === selectedIndex && 'bg-foreground/[6%]')}
        onClick={() => void onSelectChannel(item.channel.id)}
        data-track-category='DM'
        data-track-name='SELECT_DM_SEARCH_RESULT'
        data-track-label='Select DM search result'
        data-track-metadata={JSON.stringify({
          channelId: item.channel.id,
          resultCount: trackedResultCount,
          queryLength,
        })}
      >
        <DmSearchResultItem channel={item.channel} />
      </button>
    );
  };

  return (
    <div className='absolute top-full left-0 right-0 z-50 mt-2 max-h-80 overflow-hidden rounded-xl border border-border bg-background p-1.5 shadow-lg'>
      {showNoResults ? (
        <div className='px-2 py-1.5 text-sm text-muted-foreground'>No results found</div>
      ) : noResults ? (
        <div className='px-2 py-1.5 text-sm text-muted-foreground'>Searching…</div>
      ) : isVirtualized ? (
        <Virtuoso
          ref={virtuosoRef}
          data={items}
          data-testid='dm-search-results'
          style={{ height: virtualizedHeight, width: '100%', overflowX: 'hidden' }}
          defaultItemHeight={ROW_HEIGHT}
          overscan={200}
          computeItemKey={(_, item) => getItemKey(item)}
          itemContent={(index, item) => <>{renderItem(item, index)}</>}
        />
      ) : (
        <ul
          ref={plainListRef}
          data-testid='dm-search-results'
          style={{ maxHeight: MAX_HEIGHT, overflowY: 'auto' }}
        >
          {items.map((item, index) => (
            <li key={getItemKey(item)}>{renderItem(item, index)}</li>
          ))}
        </ul>
      )}
    </div>
  );
};

// Props (memo arrays from useDmsSearch + scalars + stable callbacks) stay referentially stable
// while typing, so keystroke renders skip the entire dropdown subtree.
export const DmSearchDropdown = memo(DmSearchDropdownComponent);
