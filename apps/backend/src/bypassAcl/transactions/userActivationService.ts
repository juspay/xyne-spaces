import { transaction } from '../base';
import { UserActivationService } from '@/services/userActivationService';
import { UserStatus } from '@xyne/shared';


export function bulkUpdateUserStatusTx(self: UserActivationService, batch: string[], workspaceId: string, status: UserStatus) {
  return transaction(['User', 'UserAssignmentState', 'UserExpertiseMapping', 'UserGroupMapping'], 'bulkUpdateUserStatus: user status update with assignment-state teardown must commit atomically; tx is not ACL-wrapped', self.prisma, async (tx) => {
    await tx.user.updateMany({
      where: { id: { in: batch }, workspaceId },
      data: {
        status,
        leftAt: status === UserStatus.INACTIVE ? new Date() : null
      }
    });

    // When deactivating, remove the users from every user group in the
    // workspace and tear down their assignment-related state. These tables
    // are keyed by userId, so deleting by userId clears the rows across all
    // groups. The auto-assignment engine builds its candidate pool from
    // user_group_mappings (and gates on user_assignment_states), so removing
    // these rows takes the user out of all auto-assignment routing.
    if (status === UserStatus.INACTIVE) {
      await tx.userGroupMapping.deleteMany({
        where: { userId: { in: batch } }
      });
      await tx.userAssignmentState.deleteMany({
        where: { userId: { in: batch } }
      });
      await tx.userExpertiseMapping.deleteMany({
        where: { userId: { in: batch } }
      });
    }
  });
}
