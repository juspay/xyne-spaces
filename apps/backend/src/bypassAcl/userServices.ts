import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { repositories } from '@/database/repositories/index';
import { unifiedBotUserService } from '@/bots/unified/services/unified-bot-user-service.js';
import { grantPermissionsForRole } from '@/services/permissionMatrix';
import { aiProvisioningService } from '@/services/aiProvisioningService';
import { createCommunityWorkspaceDefaults } from '@/utils/communityWorkspaceDefaults';
import { getEncryptionProvider } from '@/services/encryption';
import {
  AuthProvider,
  ProjectType,
  WorkspaceRole,
  Status,
  ChannelRole,
  UserStatus,
  WorkspaceJoinRequestStatus,
  WorkspaceType,
  UserPresenceStatus,
  type WorkspaceType as WorkspaceTypeValue,
  type WorkspaceJoinPolicy as WorkspaceJoinPolicyValue,
} from '@xyne/shared';
import { asSystem, asService } from './base';

interface WorkspaceCreateError extends Error {
  statusCode?: number;
}

function raiseWorkspaceCreateError(message: string, statusCode: number): never {
  const error = new Error(message) as WorkspaceCreateError;
  error.statusCode = statusCode;
  throw error;
}

/**
 * Relocated from services/userService.ts's createWorkspaceInOrg. Creating a workspace is
 * inherently cross-tenant: the row being created/updated can never satisfy "must belong to the
 * caller's current workspace" (there is no current workspace for something that doesn't exist
 * yet). Bootstrap as `system` — every write below already carries its own workspaceId
 * explicitly, so nothing relies on the ambient-context stamper this bypasses.
 */
export function createWorkspaceInOrgData(
  org: { orgId: string; name: string },
  userData: {
    userId: string;
    providerUserId: string;
    email: string;
    name: string;
    picture?: string | null;
    authProvider: AuthProvider;
  },
  workspaceName: string,
  workspaceType: WorkspaceTypeValue,
  joinPolicy: WorkspaceJoinPolicyValue,
  orgMember: { memberId: string },
) {
  return asSystem(
    ['Workspace', 'WorkspaceOrganization', 'OrgMember', 'User', 'Project'],
    'workspace creation is inherently cross-tenant — the row being created can never satisfy "must belong to the caller\'s current workspace"',
    async () => {
      // Step 1: Create workspace under existing org with temporary createdBy
      let workspace;
      try {
        workspace = await db.$transaction(async (tx) => {
          const createdWorkspace = await tx.workspace.create({
            data: {
              orgId: org.orgId,
              name: workspaceName,
              createdBy: userData.providerUserId, // Temporary: will update after user creation
              status: Status.ACTIVE,
              workspaceType,
              joinPolicy,
            },
          });
          await getEncryptionProvider().provisionEntity({
            entityId: createdWorkspace.id,
            orgId: createdWorkspace.orgId,
            entityType: 'WORKSPACE',
          });
          return createdWorkspace;
        });
      } catch (error) {
        if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
          raiseWorkspaceCreateError('A workspace with this name already exists. Please choose a different name.', 409);
        }
        throw error;
      }

      // Step 2: Link workspace to organization
      await db.workspaceOrganization.create({
        data: {
          orgId: org.orgId,
          workspaceId: workspace.id,
          role: WorkspaceRole.ADMIN,
        },
      });

      // Step 3: Fetch orgMember for the user (reuse existing orgMember if available)
      const userOrgMember = orgMember || await db.orgMember.findUnique({
        where: { email: userData.email },
        select: { memberId: true }
      });

      if (!userOrgMember) {
        throw new Error(`orgMember not found for email ${userData.email}. User must be added to the organization first.`);
      }

      // Step 4: Create workspace-scoped user as OWNER
      const workspaceUser = await db.user.create({
        data: {
          providerUserId: userData.providerUserId,
          email: userData.email,
          name: userData.name,
          picture: userData.picture,
          authProvider: userData.authProvider,
          workspace: { connect: { id: workspace.id } },
          role: WorkspaceRole.OWNER,
          orgMember: { connect: { memberId: orgMember.memberId } },
        },
      });

      // Step 5: Update workspace with correct createdBy (actual user ID)
      await db.workspace.update({
        where: { id: workspace.id },
        data: { createdBy: workspaceUser.id }
      });

      // Step 6: Create DM project for the workspace with correct createdBy
      await db.project.create({
        data: {
          name: 'Direct Messages',
          code: 'DM',
          description: 'DM project for direct message channels',
          type: ProjectType.DM,
          workspaceId: workspace.id,
          createdBy: workspaceUser.id,
        }
      });

      const defaults = await createCommunityWorkspaceDefaults({
        db,
        workspaceId: workspace.id,
        workspaceName,
        createdBy: workspaceUser.id,
      });

      workspace = { ...workspace, landingChannelId: defaults.workspace.landingChannelId };
      await repositories.channelParticipants.addParticipant(defaults.channel.id, workspaceUser.id, ChannelRole.ADMIN);

      // Grant full admin resource access to the workspace owner
      await grantPermissionsForRole(workspaceUser.id, workspaceUser.email, WorkspaceRole.OWNER, workspace.id);

      // Sync all hardcoded bots into the new workspace
      await unifiedBotUserService.syncAllBotUsers(workspace.id);

      try {
        await aiProvisioningService.enqueueWorkspaceSync(workspace.id);
        await aiProvisioningService.enqueueUserSync(workspaceUser.orgMemberId);
      } catch (error) {
        logger.error('[UserService] Failed to enqueue AI provisioning jobs for new workspace', {
          orgId: org.orgId,
          workspaceId: workspace.id,
          userId: workspaceUser.id,
          error,
        });
      }

      logger.info(`Created workspace "${workspaceName}" under org "${org.name}" for ${userData.email}`);
      return { organization: org, workspace, workspaceUser };
    },
  );
}

/**
 * Relocated from services/userService.ts's hasCompletedOnboarding.
 */
export function hasCompletedOnboardingQuery(email: string): Promise<boolean> {
  const normalizedEmail = email.toLowerCase().trim();
  return asSystem(
    ['QuestionnaireResponse'],
    'onboarding-completion check is keyed on email alone, before any workspace context exists',
    async () => {
      const onboardingResponse = await db.questionnaireResponse.findFirst({
        where: {
          questionnaireType: 'onboarding',
          email: normalizedEmail,
        },
        select: { id: true },
      });

      return Boolean(onboardingResponse);
    },
  );
}

/**
 * Relocated from services/userService.ts's getWorkspacesByEmail. Get all workspaces for an
 * email address — used during workspace selection flow (no auth user yet).
 */
export function getWorkspacesByEmailData(email: string): Promise<Array<{
  id: string;
  name: string;
  role: string;
  orgId: string;
  orgName: string;
  workspaceType: string | null;
  memberCount: number;
}>> {
  return asSystem(
    ['User', 'WorkspaceJoinRequest', 'Workspace'],
    'workspace selection runs before an authenticated workspace context exists',
    async () => {
      logger.info(`[getWorkspacesByEmail] Querying workspaces for email: ${email}`);
      const workspaceUsers = await db.user.findMany({
        where: {
          email: { equals: email, mode: 'insensitive' },
          status: UserStatus.ACTIVE,
          leftAt: null,
        },
        include: {
          workspace: {
            include: {
              organization: true
            }
          }
        }
      });

      const visibleWorkspaceUsers = workspaceUsers;

      logger.info(`[getWorkspacesByEmail] Found ${visibleWorkspaceUsers.length} active workspace users for email: ${email}`);
      visibleWorkspaceUsers.forEach(u => {
        logger.info(`[getWorkspacesByEmail] - User ${u.id} in workspace ${u.workspace?.id}`);
      });

      const existingWorkspaceIds = new Set(
        visibleWorkspaceUsers
          .map(wsUser => wsUser.workspaceId)
          .filter((workspaceId): workspaceId is string => Boolean(workspaceId)),
      );

      const approvedJoinRequests = await db.workspaceJoinRequest.findMany({
        where: {
          email: { equals: email, mode: 'insensitive' },
          status: WorkspaceJoinRequestStatus.APPROVED,
        },
        orderBy: { updatedAt: 'desc' },
      });

      const approvedJoinRequestWorkspaces = approvedJoinRequests.length > 0
        ? await db.workspace.findMany({
            where: {
              id: { in: approvedJoinRequests.map(request => request.workspaceId) },
              status: Status.ACTIVE,
              OR: [{ workspaceType: WorkspaceType.ENTERPRISE }, { workspaceType: null }],
            },
            include: {
              organization: true,
            },
          })
        : [];
      const approvedJoinRequestWorkspacesById = new Map(
        approvedJoinRequestWorkspaces.map(workspace => [workspace.id, workspace]),
      );

      const workspaceIds = [
        ...new Set([
          ...visibleWorkspaceUsers.map(wsUser => wsUser.workspaceId),
          ...approvedJoinRequestWorkspaces.map(ws => ws.id),
        ].filter((id): id is string => Boolean(id))),
      ];

      const memberCounts = await db.user.groupBy({
        by: ['workspaceId'],
        where: {
          workspaceId: { in: workspaceIds },
          status: UserStatus.ACTIVE,
          leftAt: null,
        },
        _count: { workspaceId: true },
      });

      const memberCountByWorkspaceId = new Map(
        memberCounts.map(group => [group.workspaceId, group._count.workspaceId]),
      );

      // Return flat list of workspaces for frontend
      const activeWorkspaces = visibleWorkspaceUsers.map(wsUser => ({
        id: wsUser.workspace!.id,
        name: wsUser.workspace!.name,
        role: wsUser.role || 'MEMBER',
        orgId: wsUser.workspace!.organization.orgId,
        orgName: wsUser.workspace!.organization.name,
        workspaceType: wsUser.workspace!.workspaceType,
        memberCount: memberCountByWorkspaceId.get(wsUser.workspace!.id) ?? 0,
      }));

      const approvedRequestWorkspaces = approvedJoinRequests
        .filter(request => !existingWorkspaceIds.has(request.workspaceId))
        .map(request => approvedJoinRequestWorkspacesById.get(request.workspaceId))
        .filter(
          (workspace): workspace is (typeof approvedJoinRequestWorkspaces)[number] =>
            Boolean(workspace),
        )
        .map(workspace => ({
          id: workspace.id,
          name: workspace.name,
          role: 'MEMBER',
          orgId: workspace.organization.orgId,
          orgName: workspace.organization.name,
          workspaceType: workspace.workspaceType,
          memberCount: memberCountByWorkspaceId.get(workspace.id) ?? 0,
        }));

      return [...activeWorkspaces, ...approvedRequestWorkspaces];
    },
  );
}

/**
 * Relocated from services/userService.ts's findAuthIdentityByEmail. Returns the auth identity
 * (provider + providerUserId) already associated with this email across any workspace, if a
 * user record exists — deliberately cross-workspace by design: used to detect logins that use a
 * different method than the account was originally created with, before any workspace has been
 * selected. Looks at the earliest-created record.
 */
export function findAuthIdentityByEmailData(
  email: string,
): Promise<{ authProvider: AuthProvider; providerUserId: string } | null> {
  return asSystem(
    ['User'],
    'provider-mismatch check runs before login: no workspace is selected yet, and the check is deliberately cross-workspace',
    async () => {
      const user = await db.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
        select: { authProvider: true, providerUserId: true },
        orderBy: { createdAt: 'asc' },
      });
      return user
        ? { authProvider: user.authProvider as AuthProvider, providerUserId: user.providerUserId }
        : null;
    },
  );
}

/**
 * Relocated from services/userService.ts's ensureUserPresence. Runs on the login/switch request
 * itself, before any ambient tenant context exists, for the specific user+workspace just
 * resolved. Kept in this module rather than bypassAcl/authServices.ts: that file instantiates
 * UserService at module scope, and UserService imports this function — importing it back from
 * there would be a circular import.
 */
export function ensureUserPresenceData(userId: string, workspaceId: string): Promise<void> {
  return asService(
    ['UserPresence'],
    'post-login user-presence upsert: runs on the request that is itself creating the session, no ambient tenant context exists yet',
    userId,
    workspaceId,
    async () => {
      try {
        const existingPresence = await db.userPresence.findUnique({
          where: { userId },
        });

        if (!existingPresence) {
          logger.info(`Creating user presence entry for user ${userId}`);
          await db.userPresence.create({
            data: {
              userId,
              workspaceId,
              status: UserPresenceStatus.ONLINE,
              lastActiveAt: new Date(),
              lastSeenAt: new Date(),
              isManual: false,
            },
          });
          logger.info(`Successfully created user presence entry for user ${userId}`);
        } else {
          // Update last seen and last active timestamps on login
          await db.userPresence.update({
            where: { userId },
            data: {
              lastActiveAt: new Date(),
              lastSeenAt: new Date(),
            },
          });
          logger.debug(`Updated user presence timestamps for user ${userId}`);
        }
      } catch (error) {
        logger.error(`Error ensuring user presence for user ${userId}:`, error);
        // Don't throw - this shouldn't block authentication
      }
    },
  );
}
