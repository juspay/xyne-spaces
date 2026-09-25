import { transaction } from '../base';
import type { Request } from 'express';
import { getEncryptionProvider } from '@/services/encryption';
import { createCommunityWorkspaceDefaults } from '@/utils/communityWorkspaceDefaults';
import { Status, WorkspaceType, WorkspaceJoinPolicy, ProjectType, WorkspaceRole, OrgRole } from '@xyne/shared';
import { PrismaClient } from '@prisma/client';


export function provisionOrgTx(prisma: PrismaClient, orgId: string, orgName: string, invitedBy: string, workspaceName: string, normalizedOwnerEmail: string, req: Request) {
  return transaction(['Board', 'Channel', 'ChannelBoardMapping', 'OrgMember', 'Organization', 'Project', 'Stage', 'Workspace', 'WorkspaceOrganization'], 'provisionOrg: org, workspace, project, defaults and owner-member rows must commit atomically; tx is not ACL-wrapped', prisma, async tx => {
    const org = await tx.organization.create({
      data: {
        orgId,
        name: orgName.trim(),
        createdBy: invitedBy,
        status: Status.ACTIVE,
      },
    });

    const workspace = await tx.workspace.create({
      data: {
        orgId: org.orgId,
        name: workspaceName.trim(),
        createdBy: invitedBy,
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

    // DM project required for every workspace
    await tx.project.create({
      data: {
        name: 'Direct Messages',
        code: 'DM',
        description: 'DM project for direct message channels',
        type: ProjectType.DM,
        workspaceId: workspace.id,
        createdBy: invitedBy,
      },
    });

    // Link workspace ↔ org
    await tx.workspaceOrganization.create({
      data: {
        orgId: org.orgId,
        workspaceId: workspace.id,
        role: WorkspaceRole.ADMIN,
      },
    });

    // Seed general channel + default project + board/stages
    await createCommunityWorkspaceDefaults({
      db: tx,
      workspaceId: workspace.id,
      workspaceName: workspaceName.trim(),
      createdBy: invitedBy,
    });

    // Add owner as org_member (email-only — no User record yet)
    await tx.orgMember.create({
      data: {
        orgId: org.orgId,
        email: normalizedOwnerEmail,
        role: OrgRole.OWNER,
        invitedBy: req.user?.email ?? undefined,
      },
    });

    return { org, workspace };
  });
}
