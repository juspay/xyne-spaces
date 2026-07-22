import { BaseSideEffectHandler } from '../base-handler';
import type { SideEffectJobConfig, UserGroupMappingPreviousValue } from '../types';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { refreshCanvasPermissionsForGroup } from '@/services/canvasPermissionSync';

/**
 * Side-effect handler for user_group_mappings (group membership).
 *
 * Group members are denormalized into each shared canvas's `permissions`, so when a
 * user joins/leaves a group we refresh the canvases shared to that group. Group
 * membership is Zero-managed, so this side-effect is the trigger (the analog of the
 * chat_container post-ingest hook for channels). Role-only updates don't change
 * membership, so only insert/delete refresh.
 */
export class UserGroupMappingsSideEffectHandler extends BaseSideEffectHandler {
  private async refresh(userGroupId: string | null | undefined): Promise<void> {
    if (!userGroupId) return;
    await refreshCanvasPermissionsForGroup(userGroupId).catch(err =>
      logger.error(`[UserGroupMappingsHandler] canvas ACL refresh failed for group ${userGroupId}: ${err}`),
    );
  }

  async onInsert(job: SideEffectJobConfig): Promise<void> {
    const mapping = await db.userGroupMapping.findUnique({
      where: { id: job.entityId },
      select: { userGroupId: true },
    });
    await this.refresh(mapping?.userGroupId);
  }

  async onDelete(job: SideEffectJobConfig): Promise<void> {
    const previousValue = job.previousValue as UserGroupMappingPreviousValue | undefined;
    if (!previousValue) {
      logger.warn(`[UserGroupMappingsHandler] No previousValue for deleted mapping ID: ${job.entityId}`);
      return;
    }
    await this.refresh(previousValue.userGroupId);
  }
}
