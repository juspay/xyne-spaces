import { transaction } from '../base';
import { UserGroupRepository, CreateUserGroupWithUsersInput } from '@/database/repositories/userGroups';
import { aclAuditService } from '@/services/aclAuditService';


export function createWithUsersTx(self: UserGroupRepository, data: CreateUserGroupWithUsersInput, actorUserId: string | undefined) {
  return transaction(['UserGroup', 'UserGroupMapping'], 'createWithUsers: user group creation with member mappings must commit atomically; tx is not ACL-wrapped', self.db, async (tx) => {
    const userGroup = await tx.userGroup.create({
      data: {
        name: data.name,
        alias: data.alias || null,
        description: data.description || null,
        metadata: data.metadata,
        workspace: data.workspace,
        // Record the creator so non-admin User Groups views can be scoped to groups they created.
        createdBy: actorUserId ?? null,
      },
    });

    // Create user mappings if userIds are provided
    if (data.userIds && data.userIds.length > 0) {
      await tx.userGroupMapping.createMany({
        data: data.userIds.map(userId => ({
          userGroupId: userGroup.id,
          workspaceId: userGroup.workspaceId,
          userId,
          ...(data.userRoleUpdates?.[userId] ? { roleId: data.userRoleUpdates[userId] } : {}),
        })),
      });
    } else if (actorUserId) {
      // If no userIds provided, add creator as a member
      await tx.userGroupMapping.create({
        data: {
          userGroupId: userGroup.id,
          workspaceId: userGroup.workspaceId,
          userId: actorUserId,
          ...(data.userRoleUpdates?.[actorUserId] ? { roleId: data.userRoleUpdates[actorUserId] } : {}),
        },
      });
    }

    // Log audit event
    await aclAuditService.logUserGroupCreated(userGroup.id, userGroup.name, actorUserId);

    return userGroup;
  });
}
