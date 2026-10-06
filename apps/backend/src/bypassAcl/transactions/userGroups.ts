import { transaction } from '../base';
import { UserGroupRepository, CreateUserGroupWithUsersInput } from '@/database/repositories/userGroups';
import { aclAuditService } from '@/services/aclAuditService';
import { UserResponsibility, UserRoleMappingEntityType } from '@xyne/shared';
import { DEFAULT_ROLE_NAME_TO_ENUM } from '@/utils/roleFrameworkUtils';


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
      const now = new Date();

      // Normalize userRoleUpdates (value may be a single roleId or an array) to roleId[] per user.
      const rolesByUser = new Map<string, string[]>();
      for (const userId of memberUserIds) {
        const raw = data.userRoleUpdates?.[userId];
        rolesByUser.set(userId, raw === undefined ? [] : Array.isArray(raw) ? raw : [raw]);
      }

      // Dual-write: stamp the legacy ugm.roleId/responsibility with each member's PRIMARY role
      // (first assigned) so the pre-multi-role dashboard - which reads only ugm.roleId - shows
      // the role until it's deployed everywhere. The full set lives in user_role_mappings below;
      // this dual-write can be dropped once the new dashboard is fully rolled out.
      const primaryRoleIds = [
        ...new Set(
          [...rolesByUser.values()].map(ids => ids[0]).filter((id): id is string => Boolean(id)),
        ),
      ];
      const primaryRoles = primaryRoleIds.length
        ? await tx.role.findMany({
            where: { id: { in: primaryRoleIds } },
            select: { id: true, name: true },
          })
        : [];
      const roleNameById = new Map(primaryRoles.map(r => [r.id, r.name]));

      await tx.userGroupMapping.createMany({
        data: memberUserIds.map(userId => {
          const primaryRoleId = rolesByUser.get(userId)?.[0] ?? null;
          const primaryRoleName = primaryRoleId ? roleNameById.get(primaryRoleId) ?? null : null;
          return {
            userGroupId: userGroup.id,
            workspaceId: userGroup.workspaceId,
            userId,
            ...(primaryRoleId
              ? {
                  roleId: primaryRoleId,
                  responsibility:
                    (primaryRoleName && DEFAULT_ROLE_NAME_TO_ENUM[primaryRoleName]) ||
                    UserResponsibility.MEMBER,
                }
              : {}),
          };
        }),
      });

      // All roles -> user_role_mappings(entityType=USER_GROUP). One row per (user, role).
      const roleRows = memberUserIds.flatMap(userId => {
        const roleIds = rolesByUser.get(userId) ?? [];
        return roleIds.map(roleId => ({
          workspaceId: userGroup.workspaceId,
          userId,
          roleId,
          entityType: UserRoleMappingEntityType.USER_GROUP,
          entityId: userGroup.id,
          createdAt: now,
          updatedAt: now,
        }));
      });
      if (roleRows.length > 0) {
        await tx.userRoleMapping.createMany({ data: roleRows, skipDuplicates: true });
      }
    }

    // Log audit event
    await aclAuditService.logUserGroupCreated(userGroup.id, userGroup.name, actorUserId);

    return userGroup;
  });
}
