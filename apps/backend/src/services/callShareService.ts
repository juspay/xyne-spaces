import { type Call } from '@prisma/client';
import { repositories } from '@/database/repositories';
import { entityAccessService } from '@/services/entityAccessService';
import { CallVisibility, ShareableEntityType } from '@xyne/shared';

/**
 * Read-side checks for who can see a call. Recording sharing writes are owned by
 * RecordingSharingService and its single REST command path.
 */
export class CallShareService {
  /**
   * Whether a caller belongs to a call's audience: its host, anyone who took part, or a
   * member of the channel it happened in. A channel call is offered to the channel, so a
   * member who could not attend can still read what came out of it.
   */
  async isCallAudience(
    call: { id: string; channelId: string | null; createdByUserId: string },
    userId: string,
  ): Promise<boolean> {
    if (call.createdByUserId === userId) return true;
    if (await repositories.calls.findParticipant(call.id, userId)) return true;
    if (!call.channelId) return false;
    return repositories.channelParticipants.isParticipant(call.channelId, userId);
  }

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
}

export const callShareService = new CallShareService();
