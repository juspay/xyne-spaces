import { type Call } from '@prisma/client';
import { entityAccessService } from '@/services/entityAccessService';
import { CallVisibility, ShareableEntityType } from '@xyne/shared';

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
}

export const callShareService = new CallShareService();
