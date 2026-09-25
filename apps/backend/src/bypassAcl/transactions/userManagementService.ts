import { transaction } from '../base';
import { UserManagementService } from '@/services/userManagementService';
import { GuestEntity } from '@xyne/shared';


export function revokeGuestEntityAccessTx(self: UserManagementService, params: { workspaceId: string; userId: string; accessibleEntityType: GuestEntity; accessibleEntityId: string; }) {
  return transaction(['CanvasParticipant', 'ChannelParticipant', 'ChannelUserStatus', 'GuestAccess'], 'revokeGuestEntityAccess: guest access delete with participant cleanup must commit atomically; tx is not ACL-wrapped', self.prisma, async tx => {
    const deleted = await tx.guestAccess.deleteMany({
      where: {
        workspaceId: params.workspaceId,
        userId: params.userId,
        accessibleEntityType: params.accessibleEntityType,
        accessibleEntityId: params.accessibleEntityId,
      },
    });

    if (deleted.count === 0) {
      return { revoked: false };
    }

    if (params.accessibleEntityType === GuestEntity.CHANNEL) {
      await tx.channelParticipant.deleteMany({
        where: { channelId: params.accessibleEntityId, userId: params.userId },
      });
      await tx.channelUserStatus.deleteMany({
        where: { channelId: params.accessibleEntityId, userId: params.userId },
      });
    }

    if (params.accessibleEntityType === GuestEntity.CANVAS) {
      await tx.canvasParticipant.deleteMany({
        where: { canvasId: params.accessibleEntityId, userId: params.userId },
      });
    }

    return { revoked: true };
  });
}
