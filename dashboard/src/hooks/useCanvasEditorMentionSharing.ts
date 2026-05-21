import { useCallback, useMemo } from 'react';
import type { Zero } from '@rocicorp/zero';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import { CanvasRole } from '@xyne/shared';
import type {
  CanvasMentionContextValue,
  MentionUser,
} from '../components/Canvas/CanvasMentionSpec/CanvasMentionSpec';
import { mutators } from '../zero/mutators';

export type CanvasParticipantRow = {
  readonly userId?: string | null;
  readonly userGroupId?: string | null;
  readonly channelId?: string | null;
  readonly role: CanvasRole;
};

interface UseCanvasEditorMentionSharingOptions {
  canvasId: string | undefined;
  z: Zero | null | undefined;
  canvasParticipants: readonly CanvasParticipantRow[];
  canvasCreatedBy: string | undefined;
  currentUserId: string;
  currentUserRole?: CanvasRole | null;
}

interface UseCanvasEditorMentionSharingReturn {
  mentionContextValue: CanvasMentionContextValue;
}

/**
 * Shared @-mention access state for canvas editors (standalone + collaborative):
 * grant mutation, participant checks, group member map, and {@link CanvasMentionContext} value.
 */
export function useCanvasEditorMentionSharing({
  canvasId,
  z,
  canvasParticipants,
  canvasCreatedBy,
  currentUserId,
  currentUserRole,
}: UseCanvasEditorMentionSharingOptions): UseCanvasEditorMentionSharingReturn {
  const grantMentionAccess = useCallback(
    (mention: MentionUser, role: CanvasRole): boolean => {
      if (!z || !canvasId) return false;

      try {
        const participantIds: Record<string, string> = { [mention.userId]: uuidv4() };
        z.mutate(
          mutators.canvas.addParticipants({
            canvasId,
            userIds: [mention.userId],
            role,
            timestamp: Date.now(),
            participantIds,
          }),
        );
        return true;
      } catch {
        toast.error('Failed to grant access', {
          description: 'Could not add user to canvas. Please try again.',
          duration: 3000,
        });
        return false;
      }
    },
    [canvasId, z],
  );
  const grantGroupMentionAccess = useCallback(
    (groupId: string, role: CanvasRole): boolean => {
      if (!z || !canvasId) return false;
      try {
        z.mutate(
          mutators.canvas.addGroupParticipant({
            canvasId,
            userGroupId: groupId,
            role,
            participantId: uuidv4(),
            timestamp: Date.now(),
          }),
        );
        return true;
      } catch {
        toast.error('Failed to grant group access', {
          description: 'Could not add group to canvas. Please try again.',
          duration: 3000,
        });
        return false;
      }
    },
    [canvasId, z],
  );

  const hasMentionAccess = useCallback(
    (userId: string): boolean => {
      const participantIds = new Set(
        canvasParticipants
          .map(p => p.userId)
          .filter((participantUserId): participantUserId is string => Boolean(participantUserId)),
      );
      return participantIds.has(userId) || canvasCreatedBy === userId;
    },
    [canvasParticipants, canvasCreatedBy],
  );

  const getMentionAccessRole = useCallback(
    (userId: string): CanvasRole | null => {
      if (!hasMentionAccess(userId)) return null;
      const row = canvasParticipants.find(p => p.userId === userId);
      if (row) return row.role;
      if (canvasCreatedBy === userId) return CanvasRole.OWNER;
      return null;
    },
    [hasMentionAccess, canvasParticipants, canvasCreatedBy],
  );
  const groupParticipantIds = useMemo(
    () =>
      new Set(
        canvasParticipants
          .filter(participant => Boolean(participant.userGroupId))
          .map(participant => participant.userGroupId)
          .filter((participantGroupId): participantGroupId is string =>
            Boolean(participantGroupId),
          ),
      ),
    [canvasParticipants],
  );
  const hasGroupMentionAccess = useCallback(
    (groupId: string): boolean => groupParticipantIds.has(groupId),
    [groupParticipantIds],
  );

  const canGrantAccess = useMemo((): boolean => {
    const role = currentUserRole ?? getMentionAccessRole(currentUserId);
    return (
      role === CanvasRole.OWNER || role === CanvasRole.EDITOR || currentUserId === canvasCreatedBy
    );
  }, [currentUserId, currentUserRole, getMentionAccessRole, canvasCreatedBy]);
  const canGrantOwnerAccess = useMemo((): boolean => {
    const role = currentUserRole ?? getMentionAccessRole(currentUserId);
    return role === CanvasRole.OWNER || currentUserId === canvasCreatedBy;
  }, [currentUserId, currentUserRole, getMentionAccessRole, canvasCreatedBy]);

  const mentionContextValue = useMemo(
    (): CanvasMentionContextValue => ({
      canGrantAccess,
      canGrantOwnerAccess,
      grantMentionAccess,
      grantGroupMentionAccess,
      hasMentionAccess,
      getMentionAccessRole,
      hasGroupMentionAccess,
    }),
    [
      canGrantAccess,
      canGrantOwnerAccess,
      grantMentionAccess,
      grantGroupMentionAccess,
      hasMentionAccess,
      getMentionAccessRole,
      hasGroupMentionAccess,
    ],
  );

  return {
    mentionContextValue,
  };
}
