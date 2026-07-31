import { type Call } from '@prisma/client';
import { entityAccessService } from '@/services/entityAccessService';
import { ShareableEntityType } from '@xyne/shared';

/**
 * Read-side check for HEADLESS call (recording) visibility. The write side
 * (share/update/unshare) lives in the Zero mutators (see calls.shareRecording /
 * calls.updateRecordingShare in packages/shared/src/zero/mutators.ts and
 * apps/backend/src/zero/mutators.ts) rather than a REST endpoint.
 */
export class CallShareService {
  async canView(call: Call, userId: string, workspaceId: string): Promise<boolean> {
    if (call.createdByUserId === userId) return true;
    return entityAccessService.hasActiveShare({
      workspaceId,
      shareableEntityType: ShareableEntityType.NOTE_TAKER,
      entityId: call.id,
      userId,
    });
  }
}

export const callShareService = new CallShareService();

