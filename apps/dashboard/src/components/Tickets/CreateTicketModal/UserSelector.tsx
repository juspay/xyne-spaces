import { useMemo, useState, type MouseEvent, type KeyboardEvent, type ReactElement } from 'react';
import { UserPlus } from '@xyne/icons';
import UserAvatar, { AvatarShape, AvatarSize } from '../../UserAvatar/UserAvatar';
import { EntitySelector } from '../../ui/EntitySelector/EntitySelector';
import type { SelectorOption } from '../../ui/EntitySelector/EntitySelector.types';
import { useActiveUsers, useSelf, useUser } from '../../../hooks/useUsers';
import { getUserDisplayName, matchesUserQuery, withYouLabel } from '../../../utils/userDisplayName';
import { useChannelAssignGate } from '../../../hooks/useChannelAssignGate';
import { useUserGroupById } from '../../../hooks/useUserGroup';
import { channelMembersFirst, currentUserFirst } from '../../../utils/channelMembersFirst';

interface UserSelectorProps {
  selectedUserId: string | null;
  onUserSelect: (userId: string | null) => void;
  channelId?: string | undefined;
  /** 'button' = form-style trigger (details panel, settings); 'compact' = avatar chip for dense rows */
  variant?: 'button' | 'compact';
  /** Compact-only: render avatar + name pill instead of the icon-only trigger */
  showLabel?: boolean;
  /**
   * Compact-only: group assignee to show when no user is assigned. The list
   * still picks users; the caller decides what assigning one does to the group.
   */
  assignedGroupId?: string | null;
  noBorder?: boolean;
  placeholder?: string;
}

/**
 * UserSelector - single-user picker built on EntitySelector.
 *
 * The compact variant renders one instance per ticket row, so everything here
 * is sized for that: the option list is built only while the popover is open,
 * and the trigger chrome is local rather than pushed into EntitySelector.
 */
export function UserSelector({
  selectedUserId,
  onUserSelect,
  channelId,
  variant = 'button',
  showLabel = false,
  assignedGroupId,
  noBorder,
  placeholder = 'Assign User',
}: UserSelectorProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const { shouldGate, memberIds, gatedAssign } = useChannelAssignGate(channelId);
  const activeUsers = useActiveUsers();
  const selfId = useSelf()?.id;
  const selectedUser = useUser(selectedUserId || '');
  const assignedGroup = useUserGroupById(assignedGroupId || '');

  /**
   * Every option allocates a <UserAvatar/> element, and a ticket list mounts one
   * UserSelector per row — so only build the list while the popover is open.
   * Closed instances carry just the pinned selected option below, which is all
   * the trigger needs.
   *
   * The full list is reordered, never truncated: channel members float up and
   * non-members stay reachable. EntitySelector virtualizes the rendering.
   */
  const userOptions: SelectorOption[] = useMemo(() => {
    if (!open) return [];
    const query = searchValue.trim();
    const matched = !query
      ? activeUsers
      : activeUsers.filter(user => matchesUserQuery(user, query));
    const membersFirst = channelMembersFirst(matched, user => user.id, memberIds);
    const ordered = currentUserFirst(membersFirst, user => user.id, selfId);
    return ordered.map(user => ({
      value: user.id,
      label: withYouLabel(getUserDisplayName(user), user.id === selfId),
      subtitle: user.email,
      icon: <UserAvatar userId={user.id} size={AvatarSize.SM} shape={AvatarShape.CIRCULAR} />,
      badge: shouldGate && !memberIds.has(user.id) ? 'Not in channel' : undefined,
    }));
  }, [open, activeUsers, searchValue, shouldGate, memberIds, selfId]);

  /**
   * Keep the selected user present in `options` even when the list above is
   * empty (popover closed) or a search filters them out — the default trigger
   * reads its label from there, and the current assignee should stay visible.
   */
  const optionsWithSelected = useMemo(() => {
    if (!selectedUser) return userOptions;
    if (userOptions.some(opt => opt.value === selectedUser.id)) return userOptions;
    const pinnedOption: SelectorOption = {
      value: selectedUser.id,
      label: getUserDisplayName(selectedUser),
      subtitle: selectedUser.email,
      icon: (
        <UserAvatar userId={selectedUser.id} size={AvatarSize.SM} shape={AvatarShape.CIRCULAR} />
      ),
      badge: shouldGate && !memberIds.has(selectedUser.id) ? 'Not in channel' : undefined,
    };
    return [pinnedOption, ...userOptions];
  }, [selectedUser, userOptions, shouldGate, memberIds]);

  const handleSelect = (userId: string | null): void => {
    if (!userId) {
      onUserSelect(null);
      return;
    }
    const name = optionsWithSelected.find(o => o.value === userId)?.label ?? 'This user';
    gatedAssign({ userId, userName: name, assign: () => onUserSelect(userId) });
  };

  // `selectedUserId` may point at a user who is not active (or not loaded yet);
  // useUser covers the full user map, so it resolves more than activeUsers does.
  // A user assignee wins over a group, matching resolveAssigneeRef.
  const assigneeName = selectedUserId
    ? selectedUser
      ? getUserDisplayName(selectedUser)
      : '…'
    : assignedGroupId
      ? assignedGroup
        ? assignedGroup.name
        : '…'
      : 'Unassigned';
  const hasAssignee = !!selectedUserId || !!assignedGroupId;
  const assigneeTooltip = hasAssignee ? `Assignee: ${assigneeName}` : 'Unassigned';

  const renderCompactTrigger = (): ReactElement => {
    const avatar = selectedUserId ? (
      <UserAvatar userId={selectedUserId} size={AvatarSize.SM} shape={AvatarShape.CIRCULAR} />
    ) : assignedGroup ? (
      // Group badge styled to match TicketHoverCard's assignee rendering.
      <span className='flex size-5 items-center justify-center rounded-full bg-border text-[9px] font-medium text-muted-foreground'>
        {assignedGroup.name.charAt(0).toUpperCase()}
      </span>
    ) : (
      <span className='inline-flex items-center justify-center w-5 h-5 rounded-sm border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-foreground'>
        <UserPlus className='w-3 h-3' />
      </span>
    );
    // Ticket rows are themselves clickable — keep trigger interaction local.
    const stopRowInteraction = (e: MouseEvent | KeyboardEvent): void => e.stopPropagation();
    return (
      <button
        type='button'
        aria-label={hasAssignee ? 'Change assignee' : 'Assign ticket'}
        data-track-category='Tickets'
        data-track-name='ToggleRowAssignee'
        onClick={stopRowInteraction}
        onKeyDown={stopRowInteraction}
        className={
          showLabel
            ? 'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-muted text-xs text-foreground hover:bg-border transition-colors whitespace-nowrap h-[24px]'
            : 'flex items-center justify-center w-5 h-5 shrink-0 overflow-hidden rounded-sm hover:opacity-80 transition-opacity leading-none'
        }
      >
        {showLabel ? (
          <>
            <span className='flex items-center justify-center w-5 h-5 shrink-0 overflow-hidden rounded-sm leading-none'>
              {avatar}
            </span>
            <span>{assigneeName}</span>
          </>
        ) : (
          <span className='flex h-full w-full items-center justify-center'>{avatar}</span>
        )}
      </button>
    );
  };

  return (
    <EntitySelector
      options={optionsWithSelected}
      selectedValue={selectedUserId}
      onSelect={handleSelect}
      placeholder={placeholder}
      searchPlaceholder='Search users...'
      isLoading={false}
      width='auto'
      isOpen={open}
      onOpenChange={setOpen}
      onSearchChange={setSearchValue}
      disableClientFiltering={true}
      noBorder={noBorder || false}
      showUnassignOption={hasAssignee}
      // There is an explicit "Unassign" row; re-clicking the current assignee
      // must not silently clear the assignment.
      allowDeselect={false}
      virtualize={true}
      {...(variant === 'compact'
        ? {
            renderTrigger: renderCompactTrigger,
            ...(showLabel ? {} : { triggerTooltip: assigneeTooltip }),
            align: 'end' as const,
            dropdownMinWidth: '16rem',
            analytics: {
              category: 'Tickets',
              searchName: 'SearchAssigneePicker',
              optionName: 'SelectRowAssignee',
              clearName: 'UnassignRowTicket',
              optionTrackId: 'ticket_assign_row',
              clearTrackId: 'ticket_unassign_row',
            },
          }
        : {})}
    />
  );
}
