import { transaction } from '../base';
import { CommunityWorkspaceService, CommunityWorkspace, CommunityJoinUserData, COMMUNITY_MEMBER_WORKSPACE_ROLE } from '@/services/communityWorkspaceService';
import { AuthProvider, OrgRole, UserStatus } from '@xyne/shared';


export function joinOpenCommunityWorkspaceTx(self: CommunityWorkspaceService, email: string, params: { workspace: CommunityWorkspace; channelId?: string; userData: CommunityJoinUserData; }, normalizedAuthProvider: AuthProvider) {
  return transaction(['OrgMember', 'User'], 'joinOpenCommunityWorkspace: org member and workspace user find-or-create must commit atomically; tx is not ACL-wrapped', self.prisma, async (tx) => {
    let orgMember = await tx.orgMember.findUnique({
      where: { email },
      select: { memberId: true },
    });

    if (!orgMember) {
      orgMember = await tx.orgMember.create({
        data: {
          orgId: params.workspace.orgId,
          email,
          role: OrgRole.COMMUNITY_MEMBER as any,
        },
        select: { memberId: true },
      });
    }

    const hasCompletedOnboarding = await self.userService.hasCompletedOnboarding(email);

    let workspaceUser = await tx.user.findUnique({
      where: {
        email_workspaceId: {
          email,
          workspaceId: params.workspace.id,
        },
      },
    });

    const isNewUser = !hasCompletedOnboarding;
    if (workspaceUser) {
      workspaceUser = await tx.user.update({
        where: { id: workspaceUser.id },
        data: {
          providerUserId: params.userData.providerUserId,
          name: params.userData.name || workspaceUser.name,
          picture: params.userData.picture ?? workspaceUser.picture,
          authProvider: normalizedAuthProvider,
          status: UserStatus.ACTIVE,
          leftAt: null,
        },
      });
    } else {
      workspaceUser = await tx.user.create({
        data: {
          providerUserId: params.userData.providerUserId,
          email,
          name: params.userData.name,
          picture: params.userData.picture,
          authProvider: normalizedAuthProvider,
          workspace: { connect: { id: params.workspace.id } },
          role: COMMUNITY_MEMBER_WORKSPACE_ROLE,
          orgMember: { connect: { memberId: orgMember.memberId } },
        },
      });
    }

    return { workspaceUser, isNewUser };
  });
}
