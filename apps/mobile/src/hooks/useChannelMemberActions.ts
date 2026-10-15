import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, InteractionManager } from 'react-native';
import { v4 as uuidv4 } from 'uuid';
import { ChannelRole } from '@xyne/shared';
import { createMenuDismissScheduler } from '@/src/features/chat/channel-members/present-after-menu-dismiss';
import { useZero } from '@/src/hooks/useZero';
import { showMessageToast } from '@/src/utils/toast';
import { awaitMutation } from '@/src/zero/awaitMutation';
import { mutators } from '@/src/zero/mutators';

type RemoveTarget = {
  userId: string;
  name: string;
};

const fail = (title: string, error: unknown): void => {
  const message = error instanceof Error ? error.message : 'Please try again.';
  Alert.alert(title, message);
};

export function useChannelMemberActions(channelId: string) {
  const zero = useZero();
  const [removeTarget, setRemoveTarget] = useState<RemoveTarget | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);
  const presentAfterDismissRef = useRef(
    createMenuDismissScheduler(callback => InteractionManager.runAfterInteractions(callback)),
  );

  useEffect(
    () => (): void => {
      presentAfterDismissRef.current.cancel();
    },
    [channelId],
  );

  const updateRole = useCallback(
    (targetUserId: string, newRole: ChannelRole) => {
      if (!channelId) return;

      void awaitMutation(
        zero.mutate(
          mutators.channel.updateParticipantRole({
            channelId,
            targetUserId,
            newRole,
            timestamp: Date.now(),
            conversationId: uuidv4(),
            messageId: uuidv4(),
            conversationParticipantId: uuidv4(),
          }),
        ),
      ).catch(error => {
        fail(
          newRole === ChannelRole.ADMIN ? 'Could not make admin' : 'Could not remove admin',
          error,
        );
      });
    },
    [channelId, zero],
  );

  const makeAdmin = useCallback(
    (targetUserId: string) => updateRole(targetUserId, ChannelRole.ADMIN),
    [updateRole],
  );

  const removeAdmin = useCallback(
    (targetUserId: string) => updateRole(targetUserId, ChannelRole.MEMBER),
    [updateRole],
  );

  const requestRemove = useCallback((target: RemoveTarget) => {
    presentAfterDismissRef.current.schedule(() => setRemoveTarget(target));
  }, []);

  const dismissRemove = useCallback(() => {
    if (isRemoving) return;
    setRemoveTarget(null);
  }, [isRemoving]);

  const confirmRemove = useCallback(() => {
    if (!channelId || !removeTarget || isRemoving) return;

    setIsRemoving(true);

    // Client removeParticipant deletes the row only. The server helper
    // decrements channel_stats.participantCount; writing it here too would
    // double-count. Header/About derive the displayed count from the live
    // channelParticipants query instead.
    void awaitMutation(
      zero.mutate(
        mutators.channel.removeParticipant({
          channelId,
          targetUserId: removeTarget.userId,
          updatedAt: Date.now(),
        }),
      ),
    )
      .then(() => {
        showMessageToast(`Removed ${removeTarget.name}`, 'success');
        setRemoveTarget(null);
      })
      .catch(error => fail('Could not remove member', error))
      .finally(() => setIsRemoving(false));
  }, [channelId, isRemoving, removeTarget, zero]);

  return {
    makeAdmin,
    removeAdmin,
    requestRemove,
    dismissRemove,
    confirmRemove,
    removeTarget,
    isRemoving,
  };
}
