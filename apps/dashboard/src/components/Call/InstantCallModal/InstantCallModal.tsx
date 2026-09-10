import { ChannelScopeType } from '@xyne/shared';
import type { VisibleChannel } from '@xyne/shared/hooks';
import { X } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAllVisibleChannels } from '../../../hooks/useChannels';
import { useSelf, useActiveUsers, useUsersById } from '../../../hooks/useUsers';
import { useParticipantCandidates } from '../../../hooks/useParticipantCandidates';
import { useZero } from '../../../hooks/useZero';
import { queries } from '../../../zero/queries';
import { SearchParticipants } from '../../../routes/CallHistoryScreen/SearchParticipants';
import {
  parseParticipants,
  matchParticipants,
  looksLikeBulkEntry,
} from '../../../utils/participantUtils';
import Button from '../../ui/Button';
import Dialog from '../../ui/Dialog';
import {
  buildChannelParticipantOption,
  buildUserGroupParticipantOption,
  buildUserParticipantOption,
} from '../participantOptions';

interface InstantCallModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (selectedParticipants: string[]) => void;
}

export const InstantCallModal: React.FC<InstantCallModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
}) => {
  const user = useSelf();
  const zero = useZero();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedParticipants, setSelectedParticipants] = useState<string[]>([]);
  const [notFoundUsers, setNotFoundUsers] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Full roster — used ONLY by the bulk-paste matcher below, which runs on Enter
  // rather than per keystroke. Reading the array is free; nothing maps over it.
  const activeUsers = useActiveUsers();
  const usersById = useUsersById();
  const allVisibleChannels = useAllVisibleChannels();

  // Focus on Search Participant Input when modal opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  const excludedUserIds = useMemo(
    () => (user?.id ? new Set([user.id]) : new Set<string>()),
    [user?.id],
  );

  // DEFAULT-scope channels only (no DMs, no group DMs).
  const channelFilter = useCallback(
    (channel: VisibleChannel) => channel.scopeType === ChannelScopeType.DEFAULT,
    [],
  );

  // Bounded + ranked candidates. Only these get turned into rows, so a keystroke
  // decorates ~40 entities instead of the whole workspace.
  const { users, userGroups, channels } = useParticipantCandidates({
    query: searchQuery,
    excludeUserIds: excludedUserIds,
    channelFilter,
  });

  const participantOptions = useMemo(
    () => [
      ...users.map(buildUserParticipantOption),
      ...channels.map(buildChannelParticipantOption),
      ...userGroups.map(buildUserGroupParticipantOption),
    ],
    [users, channels, userGroups],
  );

  // Pills for the current selection. Bulk paste can add people the ranked slice
  // never contained, and a picked channel drops out of the list as soon as the
  // query changes — both would leave a selected value with no renderable pill.
  const selectedOptions = useMemo(() => {
    const channelsById = new Map(allVisibleChannels.map(c => [c.id, c]));
    return selectedParticipants.flatMap(value => {
      if (value.startsWith('user:')) {
        const found = usersById.get(value.slice('user:'.length));
        return found ? [buildUserParticipantOption(found)] : [];
      }
      if (value.startsWith('channel:')) {
        const found = channelsById.get(value.slice('channel:'.length));
        return found ? [buildChannelParticipantOption(found)] : [];
      }
      return [];
    });
  }, [selectedParticipants, usersById, allVisibleChannels]);

  const handleSubmit = () => {
    onSubmit(selectedParticipants);
    setSelectedParticipants([]);
    setSearchQuery('');
    setNotFoundUsers([]);
    onClose();
  };

  const handleClose = () => {
    // Reset state when closing
    setSelectedParticipants([]);
    setSearchQuery('');
    setNotFoundUsers([]);
    onClose();
  };

  const handleBulkUserEntry = (query: string): boolean => {
    if (selectedParticipants.some(value => value.startsWith('channel:'))) {
      return false;
    }

    if (!looksLikeBulkEntry(query)) {
      return false;
    }

    const parsed = parseParticipants(query);
    if (parsed.length === 0) {
      return false;
    }

    const { matched, notFound } = matchParticipants(parsed, activeUsers, user?.id);

    if (matched.length === 0) {
      return false;
    }

    const nextSelected = new Set(selectedParticipants);
    for (const { userId } of matched) {
      nextSelected.add(`user:${userId}`);
    }

    setSelectedParticipants(Array.from(nextSelected));
    setNotFoundUsers(notFound.map(p => p.raw));
    setSearchQuery('');
    return true;
  };

  const participantLabel = useMemo(() => {
    if (selectedParticipants.some(v => v.startsWith('channel:'))) return 'Selected Channel';
    return 'Add participants';
  }, [selectedParticipants]);

  const notFoundMessage =
    notFoundUsers.length > 0
      ? `${notFoundUsers.length} user${notFoundUsers.length === 1 ? '' : 's'} not found`
      : undefined;

  const handleSearchQueryChange = (query: string) => {
    setSearchQuery(query);
    if (notFoundUsers.length > 0) {
      setNotFoundUsers([]);
    }
  };

  const handleMultiSelect = async (participants: string[]) => {
    const expanded = new Set<string>();
    for (const value of participants) {
      if (value.startsWith('user_group:')) {
        const groupId = value.replace('user_group:', '');
        const mappings = await zero.run(queries.getUserGroupMembers({ userGroupId: groupId }), {
          type: 'complete',
        });
        const memberIds = mappings
          .map((m: { userId: string }) => m.userId)
          .filter((id: string) => id !== user?.id);
        for (const id of memberIds) {
          expanded.add(`user:${id}`);
        }
      } else {
        expanded.add(value);
      }
    }
    setSelectedParticipants(Array.from(expanded));
    if (notFoundUsers.length > 0) {
      setNotFoundUsers([]);
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={open => !open && handleClose()}
      className='max-w-[584px] rounded-xl overflow-hidden'
      data-testid='instant-call-modal'
    >
      <div className='flex flex-col w-full'>
        <div className=''>
          <div className='flex items-start justify-between px-5 py-3.5 border-b border-border h-14'>
            <h2 className='text-[15px] font-semibold text-foreground leading-5'>
              Start an Instant Call
            </h2>
            <Button
              variant='outline'
              size='icon'
              tabIndex={-1}
              className='size-7 rounded-lg'
              onClick={handleClose}
              data-track-category='CALLS'
              data-track-name='CLOSE_INSTANT_CALL_MODAL'
              data-track-kind='passive'
              data-testid='instant-call-modal-close'
            >
              <X className='size-4' />
            </Button>
          </div>
          <div className='p-5 space-y-5'>
            <div className='space-y-2'>
              <p className='text-muted-foreground text-[13px] leading-5'>{participantLabel}</p>
              <SearchParticipants
                options={participantOptions}
                prefilledOptions={selectedOptions}
                selectedValues={selectedParticipants}
                onMultiSelect={handleMultiSelect}
                searchQuery={searchQuery}
                setSearchQuery={handleSearchQueryChange}
                ref={inputRef}
                onEnterQuerySubmit={handleBulkUserEntry}
                helperText={notFoundMessage}
                disableClientFiltering
              />
            </div>
            <div className='flex items-center justify-between'>
              <Button
                variant='outline'
                size='sm'
                className='rounded-lg text-[13px]'
                onClick={handleClose}
                data-track-category='CALLS'
                data-track-name='CANCEL_INSTANT_CALL'
                data-track-kind='passive'
                data-testid='instant-call-cancel-button'
              >
                Cancel
              </Button>
              <Button
                size='sm'
                type='submit'
                onClick={handleSubmit}
                data-track-category='CALLS'
                data-track-name='START_INSTANT_CALL'
                data-track-kind='active'
                disabled={selectedParticipants.length === 0}
                className='rounded-lg text-[13px] bg-primary hover:bg-primary hover:opacity-80 disabled:opacity-20 disabled:cursor-not-allowed'
                data-testid='instant-call-start-button'
              >
                Start Call
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Dialog>
  );
};
