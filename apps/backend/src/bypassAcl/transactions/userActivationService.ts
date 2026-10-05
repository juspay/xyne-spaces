import { transaction } from '../base';
import { UserActivationService } from '@/services/userActivationService';
import { UserStatus } from '@xyne/shared';


export function deactivateUsersTx(self: UserActivationService, scopedIds: string[]) {
  return transaction(['User', 'UserAssignmentState', 'UserExpertiseMapping', 'UserGroupMapping'], 'deactivateUsers: user status update with assignment-state teardown must commit atomically; tx is not ACL-wrapped', self.prisma, async (tx) => {
    await tx.user.updateMany({
      where: { id: { in: scopedIds } },
      data: { status: UserStatus.INACTIVE }
    });
    // Only stamp users that have not departed yet, so a re-run keeps the real date.
    await tx.user.updateMany({
      where: { id: { in: scopedIds }, leftAt: null },
      data: { leftAt: new Date() }
    });

    // These tables are keyed by userId, so deleting by userId clears the rows
    // across all groups. The auto-assignment engine builds its candidate pool from
    // user_group_mappings (and gates on user_assignment_states), so removing these
    // rows takes the user out of all auto-assignment routing.
    await tx.userGroupMapping.deleteMany({
      where: { userId: { in: scopedIds } }
    });
    await tx.userAssignmentState.deleteMany({
      where: { userId: { in: scopedIds } }
    });
    await tx.userExpertiseMapping.deleteMany({
      where: { userId: { in: scopedIds } }
    });
  });
}
