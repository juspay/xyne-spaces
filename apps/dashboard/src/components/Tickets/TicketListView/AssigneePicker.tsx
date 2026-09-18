import { ReactElement, useEffect, useMemo, useState } from 'react';
import { UserPlus } from '@xyne/icons';
import { AvatarSize } from '../../UserAvatar/UserAvatar';
import Tooltip from '../../ui/Tooltip';
import UserAvatar from '../../UserAvatar/UserAvatar';
import { EntitySelector } from '../../ui/EntitySelector/EntitySelector';
import type { SelectorOption } from '../../ui/EntitySelector/EntitySelector.types';
import { useUsers, useSelf } from '../../../hooks/useUsers';
import { useUserGroups } from '../../../hooks/useUserGroup';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { useChannelAssignGate } from '../../../hooks/useChannelAssignGate';
import { useAssigneeOptions, assigneeOptionToTicketUpdate } from '../TicketTable/TicketTableHelper';
import { surfaceMutationError } from '../../../utils/zeroMutationToast';
import { trackTicketOutcome } from '../../../services/Analytics/ticketTracking';

interface AssigneePickerProps {
  ticketId: string;
  assignedTo: string | null | undefined;
  channelId?: string | undefined;
  label?: string;
}

// Options are only built once the popover has opened — one picker mounts per
// row, and the roster + channel-members work is too expensive to pay eagerly.
const EMPTY_LIST: never[] = [];

export function AssigneePicker({
  ticketId,
  assignedTo,
  channelId,
  label,
}: AssigneePickerProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const users = useUsers();
  const userGroups = useUserGroups();
  const selfId = useSelf()?.id;
  const zero = useZero();
  // The channel-members query is expensive on prod — defer it until this
  // popover actually opens.
  const gate = useChannelAssignGate(hasOpened ? channelId : undefined);

  // assignedTo may be stored as `user:<id>` or `group:<id>` — strip for UserAvatar lookup.
  const isGroupAssignee = assignedTo?.startsWith('group:') ?? false;
  const resolvedAssigneeId = assignedTo?.replace(/^(user:|group:)/, '') || '';
  const selectedValue = resolvedAssigneeId
    ? `${isGroupAssignee ? 'group' : 'user'}:${resolvedAssigneeId}`
    : null;
  const assignedUserRow =
    !isGroupAssignee && resolvedAssigneeId
      ? users.find(user => user.id === resolvedAssigneeId)
      : undefined;
  const assignedGroupRow = isGroupAssignee
    ? userGroups.find(group => group.id === resolvedAssigneeId)
    : undefined;
  const assigneeTooltip = assignedUserRow
    ? `Assignee: ${getUserDisplayName(assignedUserRow)}`
    : assignedGroupRow
      ? `Assignee: ${assignedGroupRow.name}`
      : 'Unassigned';

  // Same options pipeline as the kanban card's assignee editor: Unassigned row
  // + members-first / (You)-pinned roster + groups, then the non-member badge.
  const baseOptions = useAssigneeOptions(
    hasOpened ? users : EMPTY_LIST,
    hasOpened ? userGroups : EMPTY_LIST,
    gate.memberIds,
    selfId,
  );
  const options = useMemo<SelectorOption[]>(() => {
    if (!gate.shouldGate) return baseOptions;
    return baseOptions.map(option => {
      if (!option.value.startsWith('user:')) return option;
      const userId = option.value.slice('user:'.length);
      return gate.memberIds.has(userId) ? option : { ...option, badge: 'Not in channel' };
    });
  }, [baseOptions, gate.shouldGate, gate.memberIds]);

  const applyUpdate = (value: string | null): void => {
    // Unassigning clears whichever column the row displays: the agent normally,
    // the team when only a group is assigned (mirrors the kanban card).
    const updates = value
      ? assigneeOptionToTicketUpdate(value)
      : isGroupAssignee
        ? { assignedTo: null, userGroupId: '' }
        : { assignedTo: null };
    void surfaceMutationError(
      zero.mutate(mutators.ticket.update({ id: ticketId, ...updates, updatedAt: Date.now() })),
      'Failed to update assignee',
    ).then(ok => {
      if (ok) {
        trackTicketOutcome(
          'TICKET_ASSIGNED',
          { id: ticketId },
          {
            surface: 'list_inline',
            unassigned: !value,
            selfAssigned: !!selfId && value === `user:${selfId}`,
          },
        );
      }
    });
  };

  const handleSelect = (value: string | null): void => {
    if (value && value.startsWith('user:')) {
      const userId = value.slice('user:'.length);
      const userName = baseOptions.find(option => option.value === value)?.label ?? 'This user';
      gate.gatedAssign({ userId, userName, assign: () => applyUpdate(value) });
    } else {
      applyUpdate(value);
    }
  };

  const handleOpenChange = (nextOpen: boolean): void => {
    if (nextOpen) setHasOpened(true);
    setOpen(nextOpen);
  };

  // Non-modal popover: the table can scroll while it's open, which would leave
  // the portaled dropdown floating (or its virtualized row unmounting under
  // it). Close on the first scroll that isn't the dropdown's own list.
  useEffect(() => {
    if (!open) return;
    const handleScroll = (event: Event): void => {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-radix-popper-content-wrapper]')) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener('scroll', handleScroll, true);
    return (): void => document.removeEventListener('scroll', handleScroll, true);
  }, [open]);

  const avatar = resolvedAssigneeId ? (
    <UserAvatar userId={resolvedAssigneeId} showActiveStatus={false} size={AvatarSize.SM} />
  ) : (
    <span className='inline-flex items-center justify-center w-5 h-5 rounded-sm border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-foreground'>
      <UserPlus className='w-3 h-3' />
    </span>
  );

  // Radix composes its own toggle onto these buttons — they only stop the
  // click/keys from reaching the row underneath.
  const trigger = label ? (
    <button
      type='button'
      onClick={e => e.stopPropagation()}
      onKeyDown={e => e.stopPropagation()}
      className='inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-muted text-xs text-foreground hover:bg-border transition-colors whitespace-nowrap h-[24px]'
      aria-label={resolvedAssigneeId ? 'Change assignee' : 'Assign ticket'}
      data-track-category='Tickets'
      data-track-name='ToggleRowAssignee'
    >
      <span className='flex items-center justify-center w-5 h-5 shrink-0 overflow-hidden rounded-sm leading-none'>
        {avatar}
      </span>
      <span>{label}</span>
    </button>
  ) : (
    <button
      type='button'
      onClick={e => e.stopPropagation()}
      onKeyDown={e => e.stopPropagation()}
      className='flex items-center justify-center w-5 h-5 shrink-0 overflow-hidden rounded-sm hover:opacity-80 transition-opacity leading-none'
      aria-label={resolvedAssigneeId ? 'Change assignee' : 'Assign ticket'}
      data-track-category='Tickets'
      data-track-name='ToggleRowAssignee'
    >
      <Tooltip content={assigneeTooltip}>
        <span className='flex h-full w-full items-center justify-center'>{avatar}</span>
      </Tooltip>
    </button>
  );

  return (
    // The dropdown portal's clicks bubble through the React tree to the row —
    // this wrapper keeps a selection from also opening the ticket.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, local-rules/require-tracking-on-click -- propagation island; the controls inside carry their own tracking
    <span
      className='contents'
      onClick={e => e.stopPropagation()}
      onKeyDown={e => e.stopPropagation()}
    >
      <EntitySelector
        options={options}
        selectedValue={selectedValue}
        onSelect={handleSelect}
        placeholder='Select assignee'
        searchPlaceholder='Search users...'
        virtualize
        align='end'
        dropdownMinWidth='16rem'
        isOpen={open}
        onOpenChange={handleOpenChange}
        trigger={trigger}
        onCloseAutoFocus={event => event.preventDefault()}
      />
    </span>
  );
}
