import { ReactElement, useState, useEffect, useMemo } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { Search, Check, User as UserIcon } from 'lucide-react';
import Avatar from '../../../../ui/Avatar/Avatar';
import Input from '../../../../ui/Input/Input';
import { useUsers, useSelf } from '../../../../../hooks/useUsers';
import { useChannelMemberIds } from '../../../../../hooks/useChannelMemberIds';
import type { User } from '../../../../../machines/stateMachine';
import {
  getUserDisplayName,
  isUserDeactivated,
  withYouLabel,
  matchesUserQuery,
} from '../../../../../utils/userDisplayName';
import { usePlatform } from '../../../../../hooks/usePlatform';
import { Switch } from '../../../../ui/Switch';
import { UNASSIGNED_FILTER_VALUE, ASSIGNEE_INVERT_MARKER } from '../../../../../zero/queries';

interface UserSubmenuProps {
  selectedUsers: string[];
  onChange: (userIds: string[]) => void;
  label: string;
  availableUsers?: string[];
  className?: string;
  /** Offer an "Unassigned" option that filters tickets with no assignee. */
  includeUnassigned?: boolean;
  /** Offer an "Exclude selected" toggle that inverts the selection. */
  allowInvert?: boolean;
  /** When set, members of this channel are ranked above non-members. */
  channelId?: string | undefined;
  /**
   * Users to rank first when there is no channel context — e.g. a project
   * board ranks people already on the project's tickets. Ignored when
   * `channelId` is set (channel membership takes precedence). Any `user:`/
   * `group:` selector prefix is stripped defensively before matching.
   */
  priorityUserIds?: string[] | undefined;
  /** Sink deactivated users to the bottom of the list (used by the assignee filter). */
  demoteDeactivated?: boolean;
}

const SELECT_ALL_MARKER = '__SELECT_ALL__';

// A row is either a user or the pinned "Unassigned" option.
type RowItem = User | typeof UNASSIGNED_FILTER_VALUE | typeof SELECT_ALL_MARKER;

// Virtualize once the list is big enough to matter; below this a plain list
// avoids the Virtuoso overhead. Height matches the previous max-h-80 cap.
const VIRTUALIZE_THRESHOLD = 30;
const LIST_HEIGHT = 320;

export const UserSubmenu = ({
  selectedUsers: selectedValues,
  onChange,
  label,
  availableUsers: availableUserIds,
  className = '',
  includeUnassigned = false,
  allowInvert = false,
  channelId,
  priorityUserIds,
  demoteDeactivated = false,
}: UserSubmenuProps): ReactElement => {
  // The invert marker rides inside the selection array; strip it for all
  // selection/ordering logic so it never behaves like a user id.
  const isInverted = selectedValues.includes(ASSIGNEE_INVERT_MARKER);
  const selectedUsers = useMemo(
    () => selectedValues.filter(value => value !== ASSIGNEE_INVERT_MARKER),
    [selectedValues],
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const { isMobile } = usePlatform();

  // 1. Debounced Search
  useEffect(() => {
    const timer = setTimeout(() => setSearchTerm(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const users = useUsers();
  const selfId = useSelf()?.id;
  const { memberIds } = useChannelMemberIds(channelId);

  // Users to float to the top: channel members when scoped to a channel,
  // otherwise the caller-provided priority set (e.g. project-board people).
  const priorityUserIdSet = useMemo(() => {
    if (channelId) return memberIds;
    const ids = new Set<string>();
    for (const id of priorityUserIds ?? []) {
      ids.add(id.replace(/^(user:|group:|userGroup:)/, ''));
    }
    return ids;
  }, [channelId, memberIds, priorityUserIds]);

  const usersMap = useMemo(() => {
    return new Map<string, User>(users.map((u: User) => [u.id, u]));
  }, [users]);

  const normalizedAvailableUserIds = useMemo(() => {
    if (!availableUserIds || availableUserIds.length === 0) return null;
    const ids = new Set<string>();
    for (const id of availableUserIds) {
      const rawId = id.replace(/^(user:|group:|userGroup:)/, '');
      ids.add(rawId);
    }
    return ids;
  }, [availableUserIds]);

  // All users come from the local Zero cache, so there is no fetch cost to
  // showing everyone — the list is virtualized below, so DOM size stays flat.
  const rows = useMemo((): RowItem[] => {
    const searchLower = searchTerm.toLowerCase().trim();

    let baseUsers: User[] = [];

    if (searchLower) {
      baseUsers = users.filter((user: User) => matchesUserQuery(user, searchTerm));
    } else if (normalizedAvailableUserIds) {
      // Scope to the board's users, keeping any selected users visible.
      const idSet = new Set<string>();
      const list: User[] = [];

      for (const userId of selectedUsers) {
        if (idSet.has(userId)) continue;
        const user = usersMap.get(userId);
        if (user) {
          idSet.add(userId);
          list.push(user);
        }
      }
      for (const rawId of normalizedAvailableUserIds) {
        if (idSet.has(rawId)) continue;
        const user = usersMap.get(rawId);
        if (user) {
          idSet.add(rawId);
          list.push(user);
        }
      }
      baseUsers = list;
    } else {
      baseUsers = users;
    }

    // Order (each group alphabetical):
    //   1. selected filter chips (stay on top so they can be deselected)
    //   2. the current user ("You")
    //   3. (assignee filters) active before deactivated — deactivated sink last
    //   4. priority users: channel members, or project-ticket people
    //   5. everyone else
    // With no priority set and no deactivation demotion this collapses to the
    // previous selected-first/alphabetical order.
    const selectedSet = new Set(selectedUsers);
    const sorted = [...baseUsers].sort((a, b) => {
      const aSel = selectedSet.has(a.id) ? 1 : 0;
      const bSel = selectedSet.has(b.id) ? 1 : 0;
      if (aSel !== bSel) return bSel - aSel;
      const aSelf = a.id === selfId ? 1 : 0;
      const bSelf = b.id === selfId ? 1 : 0;
      if (aSelf !== bSelf) return bSelf - aSelf;
      if (demoteDeactivated) {
        const aDeactivated = isUserDeactivated(a) ? 1 : 0;
        const bDeactivated = isUserDeactivated(b) ? 1 : 0;
        if (aDeactivated !== bDeactivated) return aDeactivated - bDeactivated;
      }
      const aPriority = priorityUserIdSet.has(a.id) ? 1 : 0;
      const bPriority = priorityUserIdSet.has(b.id) ? 1 : 0;
      if (aPriority !== bPriority) return bPriority - aPriority;
      return getUserDisplayName(a).localeCompare(getUserDisplayName(b));
    });

    // "Unassigned" sits between the selected users and the rest (so it is the
    // first option when nothing is selected). Hidden while searching for users.
    if (!includeUnassigned || searchLower) return sorted;
    const selectedCount = sorted.filter(user => selectedSet.has(user.id)).length;
    return [
      ...sorted.slice(0, selectedCount),
      UNASSIGNED_FILTER_VALUE,
      ...sorted.slice(selectedCount),
    ];
  }, [
    users,
    usersMap,
    normalizedAvailableUserIds,
    selectedUsers,
    searchTerm,
    includeUnassigned,
    priorityUserIdSet,
    demoteDeactivated,
    selfId,
  ]);

  // Re-attach the invert marker on every write; inverting an empty selection
  // filters nothing, so the marker is dropped with the last deselection.
  const emitChange = (nextSelected: string[], nextInverted: boolean): void => {
    onChange(
      nextInverted && nextSelected.length > 0
        ? [...nextSelected, ASSIGNEE_INVERT_MARKER]
        : nextSelected,
    );
  };

  const handleUserToggle = (userId: string) => {
    const isSelected = selectedUsers.includes(userId);
    emitChange(
      isSelected ? selectedUsers.filter(id => id !== userId) : [...selectedUsers, userId],
      isInverted,
    );
  };

  // Select-all / deselect-all toggle: visible user IDs from the filtered rows
  const visibleUserIds = useMemo(
    () => rows.filter((r): r is User => typeof r === 'object' && 'id' in r).map(u => u.id),
    [rows],
  );
  const allVisibleSelected =
    visibleUserIds.length > 0 && visibleUserIds.every(id => selectedUsers.includes(id));

  const handleSelectAllToggle = (): void => {
    if (allVisibleSelected) {
      emitChange(
        selectedUsers.filter(id => !visibleUserIds.includes(id)),
        isInverted,
      );
    } else {
      const merged = new Set([...selectedUsers, ...visibleUserIds]);
      emitChange([...merged], isInverted);
    }
  };

  const isVirtualized = rows.length > VIRTUALIZE_THRESHOLD;

  const renderUnassignedRow = (): ReactElement => {
    const isSelected = selectedUsers.includes(UNASSIGNED_FILTER_VALUE);
    return (
      <button
        key='unassigned'
        type='button'
        onClick={() => handleUserToggle(UNASSIGNED_FILTER_VALUE)}
        className={`
          w-full flex items-center gap-3 px-3 py-2 rounded-md transition-all outline-none
          ${isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted text-foreground'}
          focus-visible:ring-2 focus-visible:ring-ring
        `}
        data-track-category='Tickets'
        data-track-name='ToggleUnassignedFilter'
      >
        <span className='w-6 h-6 rounded-full border border-dashed border-muted-foreground flex items-center justify-center shrink-0'>
          <UserIcon className='w-3.5 h-3.5 text-muted-foreground' strokeWidth={1.5} />
        </span>
        <div className='flex-1 text-left min-w-0'>
          <p className='text-sm font-medium truncate'>Unassigned</p>
        </div>
        {isSelected && <Check className='w-4 h-4 text-muted-foreground shrink-0' />}
      </button>
    );
  };

  const renderSelectAllRow = (): ReactElement => (
    <button
      key={SELECT_ALL_MARKER}
      type='button'
      onClick={handleSelectAllToggle}
      className={`
        w-full flex items-center gap-3 px-3 py-2 rounded-md transition-all outline-none
        ${allVisibleSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted text-foreground'}
        focus-visible:ring-2 focus-visible:ring-ring
      `}
      data-track-category='Tickets'
      data-track-name='ToggleSelectAllUsers'
    >
      <span className='flex-1 text-left text-sm font-medium text-primary'>
        {allVisibleSelected ? 'Deselect all' : 'Select all'}
      </span>
      {allVisibleSelected && <Check className='w-4 h-4 text-primary shrink-0' />}
    </button>
  );

  const renderRow = (item: RowItem): ReactElement =>
    item === SELECT_ALL_MARKER
      ? renderSelectAllRow()
      : item === UNASSIGNED_FILTER_VALUE
        ? renderUnassignedRow()
        : renderUserRow(item);

  const renderUserRow = (user: User): ReactElement => {
    const isSelected = selectedUsers.includes(user.id);
    const displayName = withYouLabel(getUserDisplayName(user), user.id === selfId);
    const isDeactivated = isUserDeactivated(user);
    return (
      <button
        key={user.id}
        type='button'
        onClick={() => handleUserToggle(user.id)}
        className={`
          w-full flex items-center gap-3 px-3 py-2 rounded-md transition-all outline-none
          ${isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted text-foreground'}
          focus-visible:ring-2 focus-visible:ring-ring
        `}
        data-track-category='Tickets'
        data-track-name='ToggleUserFilter'
        data-track-metadata={JSON.stringify({
          userId: user.id,
          userName: displayName,
          selected: !isSelected,
        })}
      >
        <Avatar userId={user.id} size='sm' className='shrink-0' />
        <div className='flex-1 text-left min-w-0'>
          <div className='flex items-center gap-2'>
            <p
              className={`text-sm font-medium truncate ${isDeactivated ? 'text-muted-foreground' : ''}`}
            >
              {displayName}
            </p>
            {isDeactivated && (
              <span className='text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0'>
                Deactivated
              </span>
            )}
          </div>
        </div>
        {isSelected && <Check className='w-4 h-4 text-muted-foreground shrink-0' />}
      </button>
    );
  };

  return (
    <div
      className={`w-80 flex flex-col bg-background overflow-hidden border border-border rounded-lg shadow-lg ${className}`}
    >
      <div className='p-3 border-b sticky top-0 bg-background z-10'>
        <div className='relative'>
          <Search className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none' />
          <Input
            autoFocus={!isMobile}
            type='text'
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={`Search ${label.toLowerCase()}...`}
            className='pl-9 h-9'
          />
        </div>
        {allowInvert && (
          <div className='flex items-center justify-between mt-2.5 px-0.5'>
            <span
              className={`text-xs font-medium ${
                selectedUsers.length === 0 ? 'text-muted-foreground/60' : 'text-muted-foreground'
              }`}
            >
              Exclude selected
            </span>
            <Switch
              checked={isInverted}
              onCheckedChange={() => emitChange(selectedUsers, !isInverted)}
              aria-label='Exclude selected'
              disabled={selectedUsers.length === 0}
            />
          </div>
        )}
      </div>
      {rows.length > 0 ? (
        isVirtualized ? (
          <div
            role='listbox'
            aria-multiselectable='true'
            onWheel={e => e.stopPropagation()}
            onTouchMove={e => e.stopPropagation()}
          >
            <Virtuoso
              data={[SELECT_ALL_MARKER, ...rows]}
              // Row-height estimate so the scroll range is right before rows measure.
              defaultItemHeight={40}
              // Padding lives on the rows — padding on the scroller itself
              // produces a spurious horizontal scrollbar.
              style={{ height: LIST_HEIGHT, overflowX: 'hidden' }}
              itemContent={(_, item) => (
                <div className='px-1 pb-0.5 first:pt-1'>{renderRow(item)}</div>
              )}
            />
          </div>
        ) : (
          <div
            className='max-h-80 overflow-y-auto p-1'
            role='listbox'
            aria-multiselectable='true'
            onWheel={e => e.stopPropagation()}
            onTouchMove={e => e.stopPropagation()}
          >
            <div className='space-y-0.5'>
              <div className='border-b border-border/50'>{renderSelectAllRow()}</div>
              {rows.map(item => renderRow(item))}
            </div>
          </div>
        )
      ) : (
        <div className='p-8 text-center text-sm text-muted-foreground'>
          {searchQuery ? 'No matches found' : 'No users available'}
        </div>
      )}
    </div>
  );
};
