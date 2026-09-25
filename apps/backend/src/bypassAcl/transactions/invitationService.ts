import { WorkspaceRole, AuthProvider, UserStatus } from '@xyne/shared';
import { logger } from '@/utils/logger';
import { InvitationService } from '@/services/invitationService';
import { transaction } from '../base';
export function acceptInvitationTx(self: InvitationService, invitationId: string, invitation: any, userData: { id: string; email: string; name: string; providerUserId: string; authProvider: string; }) {
  return transaction(['Canvas', 'CanvasParticipant', 'Channel', 'ChannelParticipant', 'ChannelUserStatus', 'GuestAccess', 'Invitation', 'OrgMember', 'Project', 'User'], 'acceptInvitation: invitation accept plus guest org-member, user and entity-access rows must commit atomically; tx is not ACL-wrapped', self.prisma, async (tx) => {
    await self.markInvitationAccepted(tx, invitationId);
    const result = await self.handleGuestAcceptance(invitation, userData, tx);
    return result;
  });
}
export function acceptInvitationTx2(self: InvitationService, invitationId: string, existingWorkspaceUser: any, invitation: any) {
  return transaction(['Canvas', 'CanvasParticipant', 'Channel', 'ChannelParticipant', 'ChannelUserStatus', 'GuestAccess', 'Invitation', 'Project', 'User'], 'acceptInvitation: invitation accept plus user reactivate and guest entity-access rows must commit atomically; tx is not ACL-wrapped', self.prisma, async (tx) => {
    await self.markInvitationAccepted(tx, invitationId);
    const reactivatedUser = await tx.user.update({
      where: { id: existingWorkspaceUser.id },
      data: {
        leftAt: null,
        status: UserStatus.ACTIVE,
      },
    });
    const path = await self.grantGuestEntityAccess(reactivatedUser.id, invitation, tx);
    return { user: reactivatedUser, redirectPath: path };
  });
}
export function acceptInvitationTx3(self: InvitationService, invitationId: string, existingWorkspaceUser: any, invitation: any, resolvedOrgId: any, userData: { id: string; email: string; name: string; providerUserId: string; authProvider: string; }) {
  return transaction(['Invitation', 'OrgMember', 'User'], 'acceptInvitation: invitation accept plus user reactivate and org-member upsert must commit atomically; tx is not ACL-wrapped', self.prisma, async (tx) => {
    await self.markInvitationAccepted(tx, invitationId);
    const reactivatedUser = await tx.user.update({
      where: { id: existingWorkspaceUser.id },
      data: {
        leftAt: null,
        role: invitation.role,
        status: UserStatus.ACTIVE,
      },
    });

    if (resolvedOrgId) {
      await tx.orgMember.upsert({
        where: { email: userData.email.toLowerCase() },
        create: {
          orgId: resolvedOrgId,
          email: userData.email.toLowerCase(),
          role: self.toEnterpriseOrgRole(invitation.role as WorkspaceRole),
        },
        update: {
          leftAt: null,
          orgId: resolvedOrgId,
          role: self.toEnterpriseOrgRole(invitation.role as WorkspaceRole),
        },
      });
    }

    return reactivatedUser;
  });
}

export async function acceptInvitationTx4(invitationId: string, userData: { id: string; email: string; name: string; providerUserId: string; authProvider: string; }, resolvedOrgId: any, invitation: any, upgradeCommunityMemberId: string | null, self: InvitationService) {
  const result = await transaction(['Invitation', 'OrgMember', 'User'], 'acceptInvitation: invitation accept plus org-member and new-user rows must commit atomically; tx is not ACL-wrapped', self.prisma, async (tx) => {
    await self.markInvitationAccepted(tx, invitationId);
    const existingOrgMember = await tx.orgMember.findUnique({
      where: { email: userData.email.toLowerCase() },
      select: { memberId: true, role: true },
    });

    let orgMemberId: string;

    if (!existingOrgMember) {
      if (!resolvedOrgId) {
        throw new Error(`orgMember not found for email ${userData.email}. User must be invited to the organization first.`);
      }

      const created = await tx.orgMember.create({
        data: {
          orgId: resolvedOrgId,
          email: userData.email.toLowerCase(),
          role: self.toEnterpriseOrgRole(invitation.role as WorkspaceRole),
        },
        select: { memberId: true },
      });
      orgMemberId = created.memberId;
    } else if (resolvedOrgId) {
      const wasCommunityMember = existingOrgMember.role === 'COMMUNITY_MEMBER';
      const updated = await tx.orgMember.update({
        where: { memberId: existingOrgMember.memberId },
        data: {
          leftAt: null,
          orgId: resolvedOrgId,
          role: self.toEnterpriseOrgRole(invitation.role as WorkspaceRole),
        },
        select: { memberId: true },
      });
      orgMemberId = updated.memberId;

      if (wasCommunityMember) {
        upgradeCommunityMemberId = orgMemberId;
      }
    } else {
      orgMemberId = existingOrgMember.memberId;
    }

    const createdUser = await tx.user.create({
      data: {
        email: userData.email,
        name: userData.name,
        providerUserId: userData.providerUserId,
        authProvider: userData.authProvider as AuthProvider,
        workspaceId: invitation.workspaceId!,
        role: invitation.role,
        status: UserStatus.ACTIVE,
        orgMemberId,
      },
    });
    logger.info(`[DEBUG] [acceptInvitation] Created new workspace user id=${createdUser.id}`);

    return createdUser;
  });
  return { result, upgradeCommunityMemberId };
}
