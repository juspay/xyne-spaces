import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import { Users } from 'lucide-react';
import { EntityUserAccess, WorkspaceRole } from '@xyne/shared';
import { useUserGroupSearch } from '@xyne/shared/hooks';
import Avatar from '../../../components/ui/Avatar/Avatar';
import { Button } from '../../../components/ui/Button/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../components/ui/dropdown-menu';
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

const ACCESS_LABELS: Record<string, string> = {
  [EntityUserAccess.VIEW]: 'Can view',
  [EntityUserAccess.EDIT]: 'Can edit',
  [EntityUserAccess.ADMIN]: 'Full access',
};

const GRANTABLE_ACCESS_LEVELS = [
  EntityUserAccess.VIEW,
  EntityUserAccess.EDIT,
  EntityUserAccess.ADMIN,
] as const;

export const RecordingShareModal: React.FC<RecordingShareModalProps> = ({
  recording,
}) => {
  const zero = useZero();
  const { user: currentUser } = useAuth();
  const activeUsers = useActiveUsers();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedValues, setSelectedValues] = useState<string[]>([]);
  const [sharing, setSharing] = useState(false);

  const userGroups = useUserGroupSearch(searchQuery, 10);

  const [recordingRow] = useCachedQuery(queries.oatsRecordingByCallId({ callId: recording.id }));
  const shares = useMemo(() => recordingRow?.shares ?? [], [recordingRow]);

  const isOwner = Boolean(currentUser?.id && currentUser.id === recording.createdByUserId);
  const isWorkspaceAdmin =
    currentUser?.role === WorkspaceRole.OWNER || currentUser?.role === WorkspaceRole.ADMIN;
  const canManage = isOwner || isWorkspaceAdmin;

  const sharedUserIds = useMemo(
    () => new Set(shares.map(share => share.userId).filter((id): id is string => Boolean(id))),
    [shares],
  );

  // Combined "share with" search results — active workspace users + user groups.
  // Selecting a group is expanded to its current members on select (below).
  const options = useMemo(() => {
    const userOptions = activeUsers
      .filter(u => u.id !== recording.createdByUserId && !sharedUserIds.has(u.id))
      .map(u => ({
        label: getUserDisplayName(u),
        subtitle: u.email ?? '',
        value: `user:${u.id}`,
        icon: <Avatar userId={u.id} size='sm' showActiveStatus={false} />,
      }));

    const groupOptions = userGroups.map(group => ({
      label: group.name,
      subtitle: 'Group',
      value: `user_group:${group.id}`,
      icon: <Users className='size-3.5 text-muted-foreground' />,
    }));

    return [...userOptions, ...groupOptions];
  }, [activeUsers, userGroups, sharedUserIds, recording.createdByUserId]);

  const handleMultiSelect = async (values: string[]): Promise<void> => {
    const expanded = new Set<string>();
    for (const value of values) {
      if (value.startsWith('user_group:')) {
        const userGroupId = value.replace('user_group:', '');
        const mappings = await zero.run(queries.getUserGroupMembers({ userGroupId }), {
          type: 'complete',
        });
        for (const mapping of mappings) {
          if (mapping.userId && mapping.userId !== recording.createdByUserId) {
            expanded.add(`user:${mapping.userId}`);
          }
        }
      } else {
        expanded.add(value);
      }
    }
    setSelectedValues(Array.from(expanded));
  };

  const handleShare = async (): Promise<void> => {
    const targetUserIds = selectedValues
      .filter(value => value.startsWith('user:'))
      .map(value => value.replace('user:', ''));
    if (targetUserIds.length === 0) return;

    setSharing(true);
    try {
      const timestamp = Date.now();
      let failures = 0;
      for (const targetUserId of targetUserIds) {
        const result = zero.mutate(
          mutators.calls.shareRecording({
            id: uuidv4(),
            callId: recording.externalId,
            targetUserId,
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
      if (failures < targetUserIds.length) {
        toast.success(
          targetUserIds.length === 1 ? 'Recording shared' : `Shared with ${targetUserIds.length} people`,
        );
      }
      setSelectedValues([]);
      setSearchQuery('');
    } finally {
      setSharing(false);
    }
  };

  const handleAccessChange = async (targetUserId: string, entityUserAccess: EntityUserAccess): Promise<void> => {
    const result = zero.mutate(
      mutators.calls.updateRecordingShare({
        callId: recording.externalId,
        targetUserId,
        entityUserAccess,
        timestamp: Date.now(),
      }),
    );
    const res = await result.server;
    if (res.type === 'error') {
      toast.error('Failed to update access', { description: res.error.message });
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
        <p className='text-muted-foreground text-[13px] leading-5'>Share with people or a group</p>
        <SearchParticipants
          options={options}
          selectedValues={selectedValues}
          onMultiSelect={values => {
            void handleMultiSelect(values);
          }}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
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
          {shares.map(share => (
            <div key={share.id} className='flex items-center justify-between gap-2'>
              <div className='flex items-center gap-2 min-w-0'>
                <Avatar userId={share.userId ?? null} size='sm' showActiveStatus={false} />
                <span className='text-sm truncate'>
                  {share.user ? getUserDisplayName(share.user) : share.userId}
                </span>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant='outline' size='sm' className='shrink-0'>
                    {ACCESS_LABELS[share.entityUserAccess] ?? share.entityUserAccess}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {GRANTABLE_ACCESS_LEVELS.map(level => (
                    <DropdownMenuItem
                      key={level}
                      onSelect={() => share.userId && void handleAccessChange(share.userId, level)}
                    >
                      {ACCESS_LABELS[level]}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuItem
                    onSelect={() => share.userId && void handleAccessChange(share.userId, EntityUserAccess.REVOKED)}
                  >
                    Remove access
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default RecordingShareModal;
