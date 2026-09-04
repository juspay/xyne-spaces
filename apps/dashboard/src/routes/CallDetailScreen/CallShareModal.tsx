import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { EntityShareModal, type EntityShareEntry } from '../../components/Share/EntityShareModal';
import { useCachedQuery } from '../../hooks/useCachedQuery';
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
          const label = share.userGroupId
            ? (share.userGroup?.name ?? share.userGroupId)
            : share.channelId
              ? (share.channel?.name ?? share.channelId)
              : share.user
                ? getUserDisplayName(share.user)
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
    [callRow, locallyRevokedShareIds],
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
      result.shares?.forEach(share => {
        setLocallyRevokedShareIds(current => new Set(current).add(share.id));
      });
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
