import { transaction } from '../base';
import { getEncryptionProvider } from '@/services/encryption';
import { UserService } from '@/services/userService';
import { Status, WorkspaceType, WorkspaceJoinPolicy } from '@xyne/shared';


export function createOrganizationWithUserTx(self: UserService, orgId: string, orgName: string, userData: { providerUserId: string; email: string; name: string; picture?: string | null; }, workspaceName: string) {
  return transaction(['Organization', 'Workspace'], 'createOrganizationWithUser: organization plus workspace creation must commit atomically; tx is not ACL-wrapped', self.prisma, async (tx) => {
    // Step 1: Create organization with temporary createdBy (will update later)
    const organization = await tx.organization.create({
      data: {
        orgId,
        name: orgName,
        createdBy: userData.providerUserId, // Temporary: will update after user creation
        status: Status.ACTIVE
      }
    });

    // Step 2: Create workspace with temporary createdBy (will update later)
    const workspace = await tx.workspace.create({
      data: {
        orgId: organization.orgId,
        name: workspaceName,
        createdBy: userData.providerUserId, // Temporary: will update after user creation
        status: Status.ACTIVE,
        workspaceType: WorkspaceType.ENTERPRISE,
        joinPolicy: WorkspaceJoinPolicy.INVITE_ONLY,
      }
    });
    await getEncryptionProvider().provisionEntity({
      entityId: workspace.id,
      orgId: workspace.orgId,
      entityType: 'WORKSPACE',
    });
    return { organization, workspace };
  });
}
