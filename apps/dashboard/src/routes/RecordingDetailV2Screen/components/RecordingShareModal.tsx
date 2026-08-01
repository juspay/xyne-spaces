import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import { Hash, Users, X } from 'lucide-react';
import { EntityUserAccess, WorkspaceRole } from '@xyne/shared';
import { useUserGroupSearch, useChannelSearch } from '@xyne/shared/hooks';
import Avatar from '../../../components/ui/Avatar/Avatar';
import { Button } from '../../../components/ui/Button/Button';
import { SearchParticipants } from '../../CallHistoryScreen/SearchParticipants';
import { useActiveUsers } from '../../../hooks/useUsers';
import { useAuth } from '../../../hooks/useAuth';
import { useZero } from '../../../hooks/useZero';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import { mutators } from '../../../zero/mutators';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import type { RecordingDetail } from '../../../services/Recording/recordingService';

export interface RecordingShareModalProps {
  recording: RecordingDetail;
  onClose?: () => void;
}

export const RecordingShareModal: React.FC<RecordingShareModalProps> = ({ recording }) => {
  const zero = useZero();
  const { user: currentUser } = useAuth();
  const activeUsers = useActiveUsers();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedValues, setSelectedValues] = useState<string[]>([]);
  const [sharing, setSharing] = useState(false);

  const userGroups = useUserGroupSearch(searchQuery, 10);
  const channels = useChannelSearch(searchQuery, 10);

  const [recordingRow] = useCachedQuery(
    queries.oatsRecordingByExternalId({ callId: recording.externalId }),
  );
  const shares = useMemo(() => recordingRow?.shares ?? [], [recordingRow]);

  const isOwner = Boolean(currentUser?.id && currentUser.id === recording.createdByUserId);
  const isWorkspaceAdmin =
    currentUser?.role === WorkspaceRole.OWNER || currentUser?.role === WorkspaceRole.ADMIN;
  const canManage = isOwner || isWorkspaceAdmin;

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
      .filter(u => u.id !== recording.createdByUserId && !sharedUserIds.has(u.id))
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
  ]);

  const handleShare = async (): Promise<void> => {
    if (selectedValues.length === 0) return;

    setSharing(true);
    try {
      const timestamp = Date.now();
      let failures = 0;
      for (const value of selectedValues) {
        const target = value.startsWith('user_group:')
          ? { targetUserGroupId: value.replace('user_group:', '') }
          : value.startsWith('channel:')
            ? { targetChannelId: value.replace('channel:', '') }
            : { targetUserId: value.replace('user:', '') };

        const result = zero.mutate(
          mutators.calls.shareRecording({
            id: uuidv4(),
            callId: recording.externalId,
            ...target,
            entityUserAccess: EntityUserAccess.VIEW,
            timestamp,
          }),
        );
        const res = await result.server;
        if (res.type === 'error') {
          failures += 1;
          toast.error('Failed to share', { description: res.error.message });
        }
      }
      if (failures < selectedValues.length) {
        toast.success(
          selectedValues.length === 1
            ? 'Recording shared'
            : `Shared with ${selectedValues.length} recipients`,
        );
      }
      setSelectedValues([]);
      setSearchQuery('');
    } finally {
      setSharing(false);
    }
  };

  const handleAccessChange = async (
    target: { targetUserId: string } | { targetUserGroupId: string } | { targetChannelId: string },
  ): Promise<void> => {
    const result = zero.mutate(
      mutators.calls.updateRecordingShare({
        callId: recording.externalId,
        ...target,
        entityUserAccess: EntityUserAccess.REVOKED,
        timestamp: Date.now(),
      }),
    );
    const res = await result.server;
    if (res.type === 'error') {
      toast.error('Failed to remove access', { description: res.error.message });
    }
  };

  if (!canManage) {
    return (
      <div className='p-5 text-sm text-muted-foreground'>
        Only the recording owner or a workspace admin can manage sharing.
      </div>
    );
  }

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
                  ? `#${share.channel?.name ?? share.channelId}`
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
