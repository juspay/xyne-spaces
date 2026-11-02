import { transaction } from '../base';
import { UserGroupRepository, CreateUserGroupWithUsersInput } from '@/database/repositories/userGroups';
import { aclAuditService } from '@/services/aclAuditService';

/** Thrown when a create-group request references users or roles outside the group's workspace. */
export class UserGroupValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserGroupValidationError';
  }
}

export function createWithUsersTx(self: UserGroupRepository, data: CreateUserGroupWithUsersInput, actorUserId: string | undefined) {
  return transaction(['UserGroup', 'UserGroupMapping', 'User', 'Role'], 'createWithUsers: user group creation with member mappings must commit atomically; tx is not ACL-wrapped, so workspace membership of users/roles is checked explicitly below', self.db, async (tx) => {
    const workspaceId = (data.workspace as { connect?: { id?: string } } | undefined)?.connect?.id;
    if (!workspaceId) {
      throw new UserGroupValidationError('Workspace is required to create a user group');
    }

    // The caller must themselves be a user of this workspace (don't rely solely on the
    // token's workspaceId claim matching the user row).
    if (!actorUserId) {
      throw new UserGroupValidationError('An authenticated user is required to create a user group');
    }
    const actor = await tx.user.findFirst({
      where: { id: actorUserId, workspaceId },
      select: { id: true },
    });
    if (!actor) {
      throw new UserGroupValidationError('You can only create user groups in your own workspace');
    }

    // The members that will actually be mapped: the requested users, or the creator.
    const memberIds = data.userIds && data.userIds.length > 0
      ? Array.from(new Set(data.userIds))
      : [actorUserId];

    // This tx bypasses the tenant ACL, so every referenced user and role must be
    // checked against the group's workspace here — nothing from another workspace.
    if (memberIds.length > 0) {
      const usersInWorkspace = await tx.user.findMany({
        where: { id: { in: memberIds }, workspaceId },
        select: { id: true },
      });
      if (usersInWorkspace.length !== memberIds.length) {
        throw new UserGroupValidationError('All users must belong to this workspace');
      }
    }

    const roleIds = Array.from(new Set(
      memberIds
        .map(userId => data.userRoleUpdates?.[userId])
        .filter((roleId): roleId is string => !!roleId),
    ));
    if (roleIds.length > 0) {
      const rolesInWorkspace = await tx.role.findMany({
        where: { id: { in: roleIds }, workspaceId },
        select: { id: true },
      });
      if (rolesInWorkspace.length !== roleIds.length) {
        throw new UserGroupValidationError('All roles must belong to this workspace');
      }
    }

    const userGroup = await tx.userGroup.create({
      data: {
        name: data.name,
        alias: data.alias || null,
        description: data.description || null,
        metadata: data.metadata,
        workspace: { connect: { id: workspaceId } },
        // Record the creator so non-admin User Groups views can be scoped to groups they created.
        createdBy: actorUserId ?? null,
      },
    });

    if (memberIds.length > 0) {
      await tx.userGroupMapping.createMany({
        data: memberIds.map(userId => ({
          userGroupId: userGroup.id,
          workspaceId: userGroup.workspaceId,
          userId,
          ...(data.userRoleUpdates?.[userId] ? { roleId: data.userRoleUpdates[userId] } : {}),
        })),
      });
    }

    // Log audit event
    await aclAuditService.logUserGroupCreated(userGroup.id, userGroup.name, actorUserId);

    return userGroup;
  });
}
