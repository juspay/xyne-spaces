import { transaction } from '../base';
import { UserGroupRepository, CreateUserGroupWithUsersInput } from '@/database/repositories/userGroups';
import { aclAuditService } from '@/services/aclAuditService';


export function createWithUsersTx(self: UserGroupRepository, data: CreateUserGroupWithUsersInput, actorUserId: string | undefined) {
  return transaction(['UserGroup', 'UserGroupMapping', 'UserRoleMapping'], 'createWithUsers: user group creation with member mappings must commit atomically; tx is not ACL-wrapped', self.db, async (tx) => {
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

    // Create membership rows (roles live in user_role_mappings, not on the membership).
    const memberUserIds =
      data.userIds && data.userIds.length > 0
        ? data.userIds
        : actorUserId
          ? [actorUserId]
          : [];

    if (memberUserIds.length > 0) {
      await tx.userGroupMapping.createMany({
        data: memberUserIds.map(userId => ({
          userGroupId: userGroup.id,
          workspaceId: userGroup.workspaceId,
          userId,
        })),
      });

      // Assign roles via user_role_mappings(entityType=USER_GROUP). One row per (user, role).
      // Backward compatible: a value may be a single roleId (legacy) or an array of roleIds.
      if (data.userRoleUpdates) {
        const now = new Date();
        const roleRows = memberUserIds.flatMap(userId => {
          const raw = data.userRoleUpdates?.[userId];
          const roleIds = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
          return roleIds.map(roleId => ({
            workspaceId: userGroup.workspaceId,
            userId,
            roleId,
            entityType: 'USER_GROUP',
            entityId: userGroup.id,
            createdAt: now,
            updatedAt: now,
          }));
        });
        if (roleRows.length > 0) {
          await tx.userRoleMapping.createMany({ data: roleRows, skipDuplicates: true });
        }
      }
    }

    // Log audit event
    await aclAuditService.logUserGroupCreated(userGroup.id, userGroup.name, actorUserId);

    return userGroup;
  });
}
