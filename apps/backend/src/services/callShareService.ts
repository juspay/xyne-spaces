import { type Call } from '@prisma/client';
import { repositories } from '@/database/repositories';
import { entityAccessService } from '@/services/entityAccessService';
import { CallType, CallVisibility, ShareableEntityType } from '@xyne/shared';

/**
 * Read-side check for HEADLESS call (recording) visibility. Recording sharing
 * writes are owned by RecordingSharingService and its single REST command path.
 */
export class CallShareService {
  async canView(call: Call, userId: string, workspaceId: string): Promise<boolean> {
    if (call.workspaceId !== workspaceId) return false;
    if (call.createdByUserId === userId) return true;
    if (call.visibility === CallVisibility.PUBLIC) return true;
    return entityAccessService.hasActiveShare({
      workspaceId,
      shareableEntityType: ShareableEntityType.NOTE_TAKER,
      entityId: call.id,
      userId,
    });
  }

  /**
   * Read-side visibility for a call of either kind. A recording is private until
   * shared, so it defers to canView above; a regular call is visible to its host,
   * anyone who took part, the channel it happened in, and anyone it was shared with.
   */
  async canViewCall(call: Call, userId: string, workspaceId: string): Promise<boolean> {
    if (call.workspaceId !== workspaceId) return false;
    if (call.createdByUserId === userId) return true;
    if (call.callType === CallType.HEADLESS) return this.canView(call, userId, workspaceId);
    if (await repositories.calls.findParticipant(call.id, userId)) return true;
    if (
      call.channelId &&
      (await repositories.channelParticipants.isParticipant(call.channelId, userId))
    ) {
      return true;
    }
    return entityAccessService.hasActiveShare({
      workspaceId,
      shareableEntityType: ShareableEntityType.CALL,
      entityId: call.id,
      userId,
    });
  }
}

export const callShareService = new CallShareService();
