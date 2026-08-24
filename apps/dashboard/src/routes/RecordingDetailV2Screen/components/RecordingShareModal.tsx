import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Hash, Users, X } from 'lucide-react';
import { useUserGroupSearch, useChannelSearch } from '@xyne/shared/hooks';
import Avatar from '../../../components/ui/Avatar/Avatar';
import { Button } from '../../../components/ui/Button/Button';
import { SearchParticipants } from '../../CallHistoryScreen/SearchParticipants';
import { useActiveUsers } from '../../../hooks/useUsers';
import { useAuth } from '../../../hooks/useAuth';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import {
  recordingService,
  type RecordingDetail,
  type RecordingShareTarget,
  type RecordingTicketLinkState,
} from '../../../services/Recording/recordingService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { logRecordingError } from '../../../utils/recordingUtils';

export interface RecordingShareModalProps {
  recording: RecordingDetail;
  onClose?: () => void;
  onTicketLinkUpdated?: (ticketLink: RecordingTicketLinkState) => void;
}

export const RecordingShareModal: React.FC<RecordingShareModalProps> = ({
  recording,
  onTicketLinkUpdated,
}) => {
  const { user: currentUser } = useAuth();
  const activeUsers = useActiveUsers();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedValues, setSelectedValues] = useState<string[]>([]);
  const [sharing, setSharing] = useState(false);
  const [locallyRevokedShareIds, setLocallyRevokedShareIds] = useState<Set<string>>(new Set());

  const userGroups = useUserGroupSearch(searchQuery, 10);
  const channels = useChannelSearch(searchQuery, 10);

  const [recordingRow] = useCachedQuery(
    queries.oatsRecordingByExternalId({ callId: recording.externalId }),
  );
  const shares = useMemo(
    () => (recordingRow?.shares ?? []).filter(share => !locallyRevokedShareIds.has(share.id)),
    [locallyRevokedShareIds, recordingRow],
  );

  const sharedUserIds = useMemo(
    () => new Set(shares.map(share => share.userId).filter((id): id is string => Boolean(id))),
    [shares],
  );
  const sharedUserGroupIds = useMemo(
    () => new Set(shares.map(share => share.userGroupId).filter((id): id is string => Boolean(id))),
    [shares],
  );
  const sharedChannelIds = useMemo(
    () => new Set(shares.map(share => share.channelId).filter((id): id is string => Boolean(id))),
    [shares],
  );

  // Combined "share with" search results — active workspace users, user groups,
  // and channels. Groups/channels are shared as a single row keyed by
  // userGroupId/channelId (dynamic membership), not expanded to individual users.
  const options = useMemo(() => {
    const userOptions = activeUsers
      .filter(
        u =>
          u.id !== recording.createdByUserId &&
          u.id !== currentUser?.id &&
          !sharedUserIds.has(u.id),
      )
      .map(u => ({
        label: getUserDisplayName(u),
        subtitle: u.email ?? '',
        value: `user:${u.id}`,
        icon: <Avatar userId={u.id} size='sm' showActiveStatus={false} />,
      }));

    const groupOptions = userGroups
      .filter(group => !sharedUserGroupIds.has(group.id))
      .map(group => ({
        label: group.name,
        subtitle: 'Group',
        value: `user_group:${group.id}`,
        icon: <Users className='size-3.5 text-muted-foreground' />,
      }));

    const channelOptions = channels
      .filter(channel => !sharedChannelIds.has(channel.id))
      .map(channel => ({
        label: channel.name,
        subtitle: 'Channel',
        value: `channel:${channel.id}`,
        icon: <Hash className='size-3.5 text-muted-foreground' />,
      }));

    return [...userOptions, ...groupOptions, ...channelOptions];
  }, [
    activeUsers,
    userGroups,
    channels,
    sharedUserIds,
    sharedUserGroupIds,
    sharedChannelIds,
    recording.createdByUserId,
    currentUser?.id,
  ]);

  const handleShare = async (): Promise<void> => {
    if (selectedValues.length === 0) return;

    setSharing(true);
    try {
      const targets: RecordingShareTarget[] = selectedValues.map(value =>
        value.startsWith('user_group:')
          ? { type: 'user_group', id: value.replace('user_group:', '') }
          : value.startsWith('channel:')
            ? { type: 'channel', id: value.replace('channel:', '') }
            : { type: 'user', id: value.replace('user:', '') },
      );
      const result = await recordingService.grantRecordingAccess(recording.externalId, targets);
      if (result.shares?.length) {
        setLocallyRevokedShareIds(current => {
          const next = new Set(current);
          result.shares?.forEach(share => next.delete(share.id));
          return next;
        });
      }
      toast.success(
        selectedValues.length === 1
          ? 'Recording shared'
          : `Shared with ${selectedValues.length} recipients`,
      );
      setSelectedValues([]);
      setSearchQuery('');
    } catch (error) {
      logRecordingError('RecordingShareModal.share', error);
      toast.error('Failed to share', {
        description: getApiErrorMessage(error, 'Unable to share this recording'),
      });
    } finally {
      setSharing(false);
    }
  };

  const handleAccessChange = async (
    target: { targetUserId: string } | { targetUserGroupId: string } | { targetChannelId: string },
  ): Promise<void> => {
    const apiTarget: RecordingShareTarget =
      'targetUserId' in target
        ? { type: 'user', id: target.targetUserId }
        : 'targetUserGroupId' in target
          ? { type: 'user_group', id: target.targetUserGroupId }
          : { type: 'channel', id: target.targetChannelId };
    try {
      const result = await recordingService.revokeRecordingAccess(recording.externalId, [
        apiTarget,
      ]);
      if (result.shares?.length) {
        setLocallyRevokedShareIds(current => {
          const next = new Set(current);
          result.shares?.forEach(share => next.add(share.id));
          return next;
        });
      }
      if (result.linkedTicketId === null) {
        onTicketLinkUpdated?.({ linkedTicketId: null, linkedTicketMessageId: null });
      }
    } catch (error) {
      logRecordingError('RecordingShareModal.revoke', error);
      toast.error('Failed to remove access', {
        description: getApiErrorMessage(error, 'Unable to remove recording access'),
      });
    }
  };

  return (
    <div className='flex flex-col w-full p-5 gap-4'>
      <div className='space-y-2'>
        <p className='text-muted-foreground text-[13px] leading-5'>
          Share with people, groups, or channels
        </p>
        <SearchParticipants
          options={options}
          selectedValues={selectedValues}
          onMultiSelect={setSelectedValues}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          exclusiveSelection={false}
        />
      </div>

      <div className='flex justify-end'>
        <Button
          size='sm'
          onClick={() => void handleShare()}
          disabled={selectedValues.length === 0 || sharing}
          data-track-category='RecordingDetailV2'
          data-track-name='share_recording_confirm'
        >
          Share
        </Button>
      </div>

      {shares.length > 0 && (
        <div className='space-y-2 border-t border-border pt-3'>
          <p className='text-muted-foreground text-[13px]'>People with access</p>
          <div className='space-y-3.5 max-h-60 overflow-y-auto pr-1'>
            {shares.map(share => {
              const target = share.userGroupId
                ? { targetUserGroupId: share.userGroupId }
                : share.channelId
                  ? { targetChannelId: share.channelId }
                  : { targetUserId: share.userId! };
              const label = share.userGroupId
                ? (share.userGroup?.name ?? share.userGroupId)
                : share.channelId
                  ? `${share.channel?.name ?? share.channelId}`
                  : share.user
                    ? getUserDisplayName(share.user)
                    : share.userId;
              const icon = share.userGroupId ? (
                <Users className='size-4 text-muted-foreground shrink-0' />
              ) : share.channelId ? (
                <Hash className='size-4 text-muted-foreground shrink-0' />
              ) : (
                <Avatar userId={share.userId ?? null} size='sm' showActiveStatus={false} />
              );

              return (
                <div key={share.id} className='group flex items-center justify-between gap-2'>
                  <div className='flex items-center gap-2 min-w-0'>
                    {icon}
                    <span className='text-sm truncate'>{label}</span>
                  </div>
                  <button
                    type='button'
                    onClick={() => void handleAccessChange(target)}
                    className='shrink-0 rounded p-1 text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground group-hover:opacity-100'
                    aria-label='Remove access'
                    data-track-category='RecordingDetailV2'
                    data-track-name='revoke_recording_share'
                  >
                    <X className='size-3.5' />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default RecordingShareModal;
