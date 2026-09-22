import { db } from '@/database/client';
import { invitationService } from '@/services/invitationService';
import { unifiedBotUserService } from '@/bots/unified/services/unified-bot-user-service.js';
import { WorkspaceJoinPolicy, WorkspaceType, OrgRole, ProjectType, WorkspaceRole, Status } from '@xyne/shared';
import { createCommunityWorkspaceDefaults } from '@/utils/communityWorkspaceDefaults';
import { getEncryptionProvider } from '@/services/encryption';
import { asSystem } from './base';

/**
 * Relocated from controllers/organizationController.ts's createOrganization. The new
 * workspace/org has no relation to the caller's own workspace, so tenant ACLs would filter out
 * provisioning reads. Runs as system and keeps the DB provisioning writes atomic.
 */
export function createOrganizationWithWorkspace(
  orgId: string,
  name: string,
  description: string | undefined,
  userId: string,
  workspaceName: string,
  ownerEmail: string,
) {
  return asSystem(
    ['Organization', 'Workspace', 'Project', 'WorkspaceOrganization', 'OrgMember'],
    'new org/workspace has no relation to the caller\'s own workspace — provisioning reads would otherwise be filtered out',
    () =>
      db.$transaction(
        async (tx) => {
          // 1. Create organization
          const organization = await tx.organization.create({
            data: {
              orgId,
              name: name.trim(),
              description: description?.trim(),
              createdBy: userId,
              status: Status.ACTIVE,
            },
          });

          // 2. Create workspace for the org
          const workspace = await tx.workspace.create({
            data: {
              orgId: organization.orgId,
              name: workspaceName.trim(),
              createdBy: userId,
              status: Status.ACTIVE,
              workspaceType: WorkspaceType.ENTERPRISE,
              joinPolicy: WorkspaceJoinPolicy.INVITE_ONLY,
            },
          });

          await getEncryptionProvider().provisionEntity({
            entityId: workspace.id,
            orgId: workspace.orgId,
            entityType: 'WORKSPACE',
          });

          // 3. Create DM project for the workspace (required by the system)
          await tx.project.create({
            data: {
              name: 'Direct Messages',
              code: 'DM',
              description: 'DM project for direct message channels',
              type: ProjectType.DM,
              workspaceId: workspace.id,
              createdBy: userId,
            },
          });

          // 4. Link workspace to organization
          await tx.workspaceOrganization.create({
            data: {
              orgId: organization.orgId,
              workspaceId: workspace.id,
              role: WorkspaceRole.ADMIN,
            },
          });

          // 4b. Seed general channel + default project + board/stages
          await createCommunityWorkspaceDefaults({
            db: tx,
            workspaceId: workspace.id,
            workspaceName: workspace.name,
            createdBy: userId,
          });

          // 5. Add ownerEmail as org OWNER (email-only, no user account yet)
          await tx.orgMember.create({
            data: {
              orgId: organization.orgId,
              email: ownerEmail.trim().toLowerCase(),
              role: OrgRole.OWNER,
              invitedBy: userId,
            },
          });

          return { organization, workspace };
        },
      ),
  );
}

/**
 * Relocated from controllers/invitationController.ts's organization-provision handler. The bots
 * are synced into a workspace the caller has no relation to yet, so tenant ACLs would scope the
 * sync's User/OrgMember/Workspace reads and writes to the wrong workspace.
 */
export function syncAllBotUsersForNewWorkspace(workspaceId: string): Promise<void> {
  return asSystem(
    ['User', 'OrgMember', 'Workspace'],
    'bot sync seeds users into a workspace the caller has no relation to yet',
    () => unifiedBotUserService.syncAllBotUsers(workspaceId),
  );
}

/**
 * Relocated from controllers/organizationController.ts's createOrganization. Same reasoning as
 * createOrganizationWithWorkspace above — the invitation is for a workspace the caller has no
 * relation to yet.
 */
export function createOwnerInvitation(
  ownerEmail: string,
  workspaceId: string,
  userId: string,
  orgId: string,
) {
  return asSystem(
    ['Invitation'],
    'owner invitation is for a workspace the caller has no relation to yet',
    () =>
      invitationService.createInvitation({
        email: ownerEmail.trim().toLowerCase(),
        role: WorkspaceRole.OWNER,
        workspaceId,
        invitedBy: userId,
        orgId,
      }),
  );
}
