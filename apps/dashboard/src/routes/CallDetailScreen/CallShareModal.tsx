import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { EntityShareModal, type EntityShareEntry } from '../../components/Share/EntityShareModal';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { useUsersById } from '../../hooks/useUsers';
import { useAllChannels } from '../../hooks/useChannels';
import { useUserGroups } from '../../hooks/useUserGroup';
import { queries } from '../../zero/queries';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { callService, type CallShareTarget } from '../../services/Call/callService';
import { getApiErrorMessage } from '../../utils/apiError';
import { getRecordingSharePost } from '../../utils/recordingUtils';

export interface CallShareModalProps {
  /** The call row id — what `queries.callById` and the detail route both key on. */
  callId: string;
  /** The call's public id, which the sharing endpoints take. */
  externalId: string;
  createdByUserId: string;
  onClose?: () => void;
}

/**
 * Calls binding for {@link EntityShareModal}. No link-access section: a regular
 * call has no shareable link, only the explicit shares listed here.
 */
export const CallShareModal: React.FC<CallShareModalProps> = ({
  callId,
  externalId,
  createdByUserId,
  onClose,
}) => {
  // Revoking is optimistic: the row leaves the list at once, and Zero catches up.
  const [locallyRevokedShareIds, setLocallyRevokedShareIds] = useState<Set<string>>(new Set());

  const [callRow] = useCachedQuery(queries.callById({ callId }));
  const usersById = useUsersById();
  const allChannels = useAllChannels();
  const channelNamesById = useMemo(
    () => new Map(allChannels.map(channel => [channel.id, channel.name])),
    [allChannels],
  );
  const userGroups = useUserGroups();
  const userGroupNamesById = useMemo(
    () => new Map(userGroups.map(group => [group.id, group.name])),
    [userGroups],
  );

  const shares = useMemo<EntityShareEntry[]>(
    () =>
      (callRow?.shares ?? [])
        .filter(share => !locallyRevokedShareIds.has(share.id))
        .map(share => {
          const target: CallShareTarget = share.userGroupId
            ? { type: 'user_group', id: share.userGroupId }
            : share.channelId
              ? { type: 'channel', id: share.channelId }
              : { type: 'user', id: share.userId! };
          const user = share.userId ? usersById.get(share.userId) : undefined;
          const label = share.userGroupId
            ? (userGroupNamesById.get(share.userGroupId) ?? share.userGroupId)
            : share.channelId
              ? (channelNamesById.get(share.channelId) ?? 'Private channel')
              : user
                ? getUserDisplayName(user)
                : (share.userId ?? '');
          const post = getRecordingSharePost(share.metadata);
          return {
            id: share.id,
            label,
            userId: share.userId ?? null,
            target,
            post: post ? { channelId: post.channelId, conversationId: post.conversationId } : null,
          };
        }),
    [callRow, locallyRevokedShareIds, usersById, channelNamesById, userGroupNamesById],
  );

  const handleGrant = async (targets: CallShareTarget[], messageContent: string): Promise<void> => {
    const result = await callService.grantCallAccess(externalId, targets, messageContent);
    if (result.shares?.length) {
      setLocallyRevokedShareIds(current => {
        const next = new Set(current);
        result.shares?.forEach(share => next.delete(share.id));
        return next;
      });
    }
  };

  const handleRevoke = async (target: CallShareTarget): Promise<void> => {
    try {
      const result = await callService.revokeCallAccess(externalId, [target]);
      if (result.shares?.length) {
        setLocallyRevokedShareIds(current => {
          const next = new Set(current);
          result.shares?.forEach(share => next.add(share.id));
          return next;
        });
      }
    } catch (error) {
      toast.error('Failed to remove access', {
        description: getApiErrorMessage(error, 'Unable to remove call access'),
      });
    }
  };

  return (
    <EntityShareModal
      ownerId={createdByUserId}
      shares={shares}
      onGrant={handleGrant}
      onRevoke={handleRevoke}
      subject='call'
      trackCategory='CallDetail'
      accessListTitle='Shared with'
      {...(onClose && { onClose })}
    />
  );
};
