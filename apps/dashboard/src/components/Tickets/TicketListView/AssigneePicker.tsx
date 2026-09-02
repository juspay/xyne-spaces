import { ReactElement, useEffect, useMemo, useRef, useState } from 'react';
import { Search, UserPlus, X } from 'lucide-react';
import { AvatarSize } from '../../UserAvatar/UserAvatar';
import { Popover } from '../../ui/Popover/Popover';
import UserAvatar from '../../UserAvatar/UserAvatar';
import { useActiveUsers, useSelf } from '../../../hooks/useUsers';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { getUserDisplayName, withYouLabel, matchesUserQuery } from '../../../utils/userDisplayName';
import { cn } from '../../../utils/classNames';
import { useChannelAssignGate } from '../../../hooks/useChannelAssignGate';
import { channelMembersFirst, currentUserFirst } from '../../../utils/channelMembersFirst';
import { surfaceMutationError } from '../../../utils/zeroMutationToast';
import { Button } from '../../ui/Button/Button';

interface AssigneePickerProps {
  ticketId: string;
  assignedTo: string | null | undefined;
  channelId?: string | undefined;
  label?: string;
}

type PickerUser = NonNullable<ReturnType<typeof useActiveUsers>>[number];

export function AssigneePicker({
  ticketId,
  assignedTo,
  channelId,
  label,
}: AssigneePickerProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const users = useActiveUsers();
  const selfId = useSelf()?.id;
  const zero = useZero();
  const gate = useChannelAssignGate(channelId);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  // assignedTo may be stored as `user:<id>` or `group:<id>` — strip for UserAvatar lookup.
  const resolvedAssigneeId = assignedTo?.replace(/^(user:|group:)/, '') || '';

  const filteredUsers = useMemo(() => {
    if (!users) return [];
    const q = search.trim().toLowerCase();
    const matched = !q ? users : users.filter(u => matchesUserQuery(u, search));
    // You first, then channel members, then non-members (kept, since a user who
    // left the channel may still be the assignee). Applies idle and searching.
    const membersFirst = channelMembersFirst(matched, u => u.id, gate.memberIds);
    return currentUserFirst(membersFirst, u => u.id, selfId);
  }, [users, search, gate.memberIds, selfId]);

  const assign = (userId: string | null): void => {
    void surfaceMutationError(
      zero.mutate(
        mutators.ticket.update({ id: ticketId, assignedTo: userId, updatedAt: Date.now() }),
      ),
      'Failed to update assignee',
    );
    setOpen(false);
    setSearch('');
  };

  const handleSelectUser = (user: PickerUser): void => {
    gate.gatedAssign({
      userId: user.id,
      userName: getUserDisplayName(user),
      assign: () => assign(user.id),
    });
  };

  const avatar = resolvedAssigneeId ? (
    <UserAvatar userId={resolvedAssigneeId} showActiveStatus={false} size={AvatarSize.SM} />
  ) : (
    <span className='inline-flex items-center justify-center w-5 h-5 rounded-sm border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-foreground'>
      <UserPlus className='w-3 h-3' />
    </span>
  );

  const trigger = label ? (
    <button
      type='button'
      onClick={e => {
        e.stopPropagation();
        setOpen(prev => !prev);
      }}
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
      onClick={e => {
        e.stopPropagation();
        setOpen(prev => !prev);
      }}
      onKeyDown={e => e.stopPropagation()}
      className='flex items-center justify-center w-5 h-5 shrink-0 overflow-hidden rounded-sm hover:opacity-80 transition-opacity leading-none'
      aria-label={resolvedAssigneeId ? 'Change assignee' : 'Assign ticket'}
      data-track-category='Tickets'
      data-track-name='ToggleRowAssignee'
    >
      {avatar}
    </button>
  );

  return (
    <Popover
      trigger={trigger}
      open={open}
      onOpenChange={setOpen}
      modal
      align='end'
      sideOffset={4}
      className='p-0 w-64'
    >
      <div className='flex flex-col max-h-72'>
        <div className='p-2 border-b border-border'>
          <div className='relative'>
            <Search className='absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground' />
            <input
              ref={searchRef}
              type='text'
              placeholder='Search users...'
              value={search}
              onChange={e => setSearch(e.target.value)}
              className='w-full pl-8 pr-2 py-1.5 border border-input rounded-md bg-background text-xs text-foreground placeholder:text-muted-foreground focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none'
              data-track-category='Tickets'
              data-track-name='SearchAssigneePicker'
            />
          </div>
        </div>
        <div className='overflow-y-auto flex-1'>
          <Button
            variant='ghost'
            type='button'
            trackId='ticket_unassign_row'
            onClick={e => {
              e.stopPropagation();
              assign(null);
            }}
            className={cn(
              'w-full text-left px-3 py-2 text-xs hover:bg-muted transition-colors flex items-center gap-2',
              !resolvedAssigneeId && 'bg-muted',
            )}
            data-track-category='Tickets'
            data-track-name='UnassignRowTicket'
          >
            <span className='flex items-center justify-center w-5 h-5 rounded-sm bg-border'>
              <X className='w-3 h-3 text-muted-foreground' />
            </span>
            <span className='text-foreground'>Unassigned</span>
          </Button>
          {filteredUsers.map(user => (
            <Button
              key={user.id}
              variant='ghost'
              type='button'
              trackId='ticket_assign_row'
              onClick={e => {
                e.stopPropagation();
                handleSelectUser(user);
              }}
              className={cn(
                'w-full text-left px-3 py-2 text-xs hover:bg-muted transition-colors flex items-center gap-2',
                resolvedAssigneeId === user.id && 'bg-muted',
              )}
              data-track-category='Tickets'
              data-track-name='SelectRowAssignee'
            >
              <UserAvatar userId={user.id} showActiveStatus={false} size={AvatarSize.SM} />
              <div className='flex-1 min-w-0'>
                <div className='text-foreground truncate'>
                  {withYouLabel(getUserDisplayName(user), user.id === selfId)}
                </div>
                {user.email ? (
                  <div className='text-[10px] text-muted-foreground truncate'>{user.email}</div>
                ) : null}
              </div>
              {gate.shouldGate && !gate.memberIds.has(user.id) && (
                <span className='shrink-0 text-[10px] leading-none px-1.5 py-0.5 rounded border border-border bg-muted text-muted-foreground whitespace-nowrap'>
                  Not in channel
                </span>
              )}
            </Button>
          ))}
          {filteredUsers.length === 0 && (
            <div className='px-3 py-3 text-xs text-muted-foreground text-center'>
              No users found
            </div>
          )}
        </div>
      </div>
    </Popover>
  );
}
