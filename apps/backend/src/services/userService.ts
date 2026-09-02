import { PrismaClient, User } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { logger } from '../utils/logger';
import { repositories } from '../database/repositories/index';
import { DatabaseClient } from '@/database/client';
import { runAsSystem } from '@/database/tenant/context';
import { unifiedBotUserService } from '@/bots/unified/services/unified-bot-user-service.js';
import { grantPermissionsForRole, syncOrgResourceAdminAccess } from './permissionMatrix';
import { USER_PREFERENCE_NOTIFICATION_DEFAULTS } from '@/constants/userPreferenceDefaults';
import { OrgRole,
  WorkspaceJoinPolicy,
  WorkspaceType,
  UserPresenceStatus,
  AuthProvider,
  ProjectType,
  UserStatus,
  WorkspaceRole,
  Status, ChannelRole, WorkspaceJoinRequestStatus } from '@xyne/shared';
import type { WorkspaceJoinPolicy as WorkspaceJoinPolicyValue, WorkspaceType as WorkspaceTypeValue } from '@xyne/shared';
import { aiProvisioningService } from '@/services/aiProvisioningService';
import { isOrganizationPolicyError, organizationDomainService } from '@/services/organizationDomainService';
import { createCommunityWorkspaceDefaults } from '@/utils/communityWorkspaceDefaults';
import { ensureGeneralChannelForWorkspace } from '@/utils/workspaceGeneralChannel';
import { ensureUserInGeneralChannel as joinUserToGeneralChannel } from '@/utils/workspaceGeneralChannel';
import { redisService } from '@/services/redisService';
import { createId } from '@paralleldrive/cuid2';
import { getEncryptionProvider } from '@/services/encryption';

interface OAuthUserData {
  provider: AuthProvider;
  providerUserId: string;
  email: string;
  name: string;
  picture?: string;
}

// Keep for backward compatibility
interface GoogleUserData {
  googleId: string;
  email: string;
  name: string;
  picture?: string;
}

export interface UserWithOrgRole extends User {
  orgRole: string;
}

export class UserService {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = DatabaseClient.getInstance();
  }

  async hasCompletedOnboarding(email: string, userId?: string): Promise<boolean> {
    const normalizedEmail = email.toLowerCase().trim();
    return await runAsSystem(async () => {
      const onboardingResponse = await this.prisma.questionnaireResponse.findFirst({
        where: {
          questionnaireType: 'onboarding',
          OR: [
            { email: normalizedEmail },
            ...(userId ? [{ userId }] : []),
          ],
        },
        select: { id: true },
      });

      return Boolean(onboardingResponse);
    });
  }

  /**
   * Get org role by memberId
   */
  async getOrgRole(memberId: string): Promise<string | undefined> {
    try {
      const orgMember = await this.prisma.orgMember.findUnique({
        where: { memberId },
        select: { role: true },
      });
      return orgMember?.role ?? undefined;
    } catch (error) {
      logger.error('Error getting org role:', error);
      return undefined;
    }
  }

  /**
   * Find an existing user by Google ID and workspace 
   */
  async findUserByGoogleId(googleId: string, workspaceId: string): Promise<User | null> {
    try {
      return await this.prisma.user.findUnique({
        where: { providerUserId_workspaceId: { providerUserId: googleId, workspaceId } }
      });
    } catch (error) {
      logger.error('Error finding user by Provider User ID:', error);
      throw new Error('Failed to find user');
    }
  }

  /**
   * Find an existing user by Provider User ID and workspace
   */
  async getUserByProviderUserId(providerUserId: string, workspaceId: string): Promise<User | null> {
    try {
      return await this.prisma.user.findUnique({
        where: { providerUserId_workspaceId: { providerUserId, workspaceId } }
      });
    } catch (error) {
      logger.error('Error finding user by Provider User ID:', error);
      throw new Error('Failed to find user');
    }
  }

  /**
   * Find an existing user by email and workspace
   */
  async findUserByEmail(email: string, workspaceId: string): Promise<User | null> {
    try {
      return await this.prisma.user.findFirst({
        where: {
          email: { equals: email, mode: 'insensitive' },
          workspaceId,
        }
      });
    } catch (error) {
      logger.error('Error finding user by email:', error);
      throw new Error('Failed to find user');
    }
  }

  /**
   * Migrate a user's stored provider identity from an old id to a new one for
   * every workspace row matching this email + provider. Used to move legacy
   * Microsoft users off the tenant-scoped `oid` and onto the stable, app-wide
   * `sub` claim (which is what multi-tenant logins can rely on).
   *
   * Safe against the (providerUserId, workspaceId) unique constraint: a given
   * (email, workspaceId) has at most one row, so no two rows can collide on the
   * new id. No-op when the ids are equal. Returns the number of rows updated.
   */
  async migrateProviderUserId(
    email: string,
    authProvider: AuthProvider,
    oldProviderUserId: string,
    newProviderUserId: string,
  ): Promise<number> {
    if (!oldProviderUserId || !newProviderUserId || oldProviderUserId === newProviderUserId) {
      return 0;
    }
    try {
      const result = await this.prisma.user.updateMany({
        where: {
          email: { equals: email, mode: 'insensitive' },
          authProvider,
          providerUserId: oldProviderUserId,
        },
        data: { providerUserId: newProviderUserId },
      });
      if (result.count > 0) {
        logger.info(
          `[migrateProviderUserId] Migrated ${result.count} ${authProvider} row(s) for ${email} to new providerUserId`,
        );
      }
      return result.count;
    } catch (error) {
      logger.error('Error migrating providerUserId:', error);
      throw new Error('Failed to migrate providerUserId');
    }
  }

  /**
   * Returns the auth identity (provider + providerUserId) already associated
   * with this email across any workspace, if a user record exists.
   * Used to detect logins that use a different method than the account was
   * originally created with. Looks at the earliest-created record.
   */
  async findAuthIdentityByEmail(
    email: string,
  ): Promise<{ authProvider: AuthProvider; providerUserId: string } | null> {
    try {
      const user = await this.prisma.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
        select: { authProvider: true, providerUserId: true },
        orderBy: { createdAt: 'asc' },
      });
      return user
        ? { authProvider: user.authProvider as AuthProvider, providerUserId: user.providerUserId }
        : null;
    } catch (error) {
      logger.error('Error finding auth identity by email:', error);
      throw new Error('Failed to find auth identity');
    }
  }

  /**
   * Create a new user from OAuth data
   */
  async createUser(userData: OAuthUserData | GoogleUserData, workspaceId?: string): Promise<User> {
    try {
      // Handle both new OAuthUserData format and legacy GoogleUserData format
      const provider = 'provider' in userData ? userData.provider : AuthProvider.GOOGLE;
      const providerUserId = 'provider' in userData ? userData.providerUserId : userData.googleId;

      // Fetch existing orgMember by email to get memberId
      // orgMember should already exist (created during invitation or org setup)
      const orgMember = await this.prisma.orgMember.findFirst({
        where: { email: { equals: userData.email, mode: 'insensitive' } },
        select: { memberId: true }
      });

      if (!orgMember) {
        throw new Error(`orgMember not found for email ${userData.email}. User must be invited to the organization first.`);
      }

      const user = await this.prisma.user.create({
        data: {
          authProvider: provider,
          providerUserId: providerUserId,
          email: userData.email,
          name: userData.name,
          picture: userData.picture,
          workspace: { connect: { id: workspaceId } },
          orgMember: { connect: { memberId: orgMember.memberId } },
        },
      });

      logger.info(
        `Created new user: ${user.email} (${user.id}) without assigning to a default group.`
      );

      try {
        await aiProvisioningService.enqueueUserSync(user.orgMemberId);
      } catch (error) {
        logger.error('[UserService] Failed to enqueue AI user provisioning for created user', {
          userId: user.id,
          workspaceId: user.workspaceId,
          orgMemberId: user.orgMemberId,
          error,
        });
      }

      // grantPermissionsForRole swallows errors internally — user creation must not rollback on grant failure
      await grantPermissionsForRole(user.id, user.email, WorkspaceRole.MEMBER, user.workspaceId);

      // Add user to general channel
      await this.ensureUserInGeneralChannel(user);

      // Create user presence entry
      await this.ensureUserPresence(user.id, user.workspaceId);

      // Create user preference entry
      await this.ensureUserPreference(user.id);

      // NOTE: Vespa indexing for the user is handled uniformly by the setupUserVespaSync
      // Prisma middleware (fires on every user create/upsert), not here — so invitation,
      // provisioning, community, controller and bot creates are all covered too.

      return user;
    } catch (error) {
      logger.error('Error creating user:', error);
      throw new Error('Failed to create user');
    }
  }

  /**
   * Update existing user data
   */
  async updateUser(userId: string, updates: Partial<GoogleUserData>): Promise<User> {
    try {
      const updateData: any = {};

      if (updates.email) updateData.email = updates.email;
      if (updates.name) updateData.name = updates.name;
      if (updates.googleId) updateData.providerUserId = updates.googleId;
      if (updates.picture) updateData.picture = updates.picture;

      const user = await this.prisma.user.update({
        where: { id: userId },
        data: updateData,
      });

      logger.info(`Updated user: ${user.email} (${user.id})`);
      return user;
    } catch (error) {
      logger.error('Error updating user:', error);
      throw new Error('Failed to update user');
    }
  }

  /**
   * Ensure user presence entry exists (create if not exists)
   */
  async ensureUserPresence(userId: string, workspaceId: string): Promise<void> {
    try {
      const existingPresence = await this.prisma.userPresence.findUnique({
        where: { userId },
      });

      if (!existingPresence) {
        logger.info(`Creating user presence entry for user ${userId}`);
        await this.prisma.userPresence.create({
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
        await this.prisma.userPresence.update({
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
  }

  /**
   * Ensure user preference entry exists (create if not exists)
   */
  async ensureUserPreference(userId: string): Promise<void> {
    try {
      const existingPreference = await this.prisma.userPreference.findUnique({
        where: { userId },
      });

      if (!existingPreference) {
        logger.info(`Creating user preference entry for user ${userId}`);
        const user = await this.prisma.user.findUniqueOrThrow({
          where: { id: userId },
          select: { workspaceId: true },
        });
        await this.prisma.userPreference.create({
          data: {
            ...USER_PREFERENCE_NOTIFICATION_DEFAULTS,
            userId,
            workspaceId: user.workspaceId,
            askai_custom_instruction: null, // Initialize with null
          },
        });
        logger.info(`Successfully created user preference entry for user ${userId}`);
      } else {
        logger.debug(`User preference already exists for user ${userId}`);
      }
    } catch (error) {
      logger.error(`Error ensuring user preference for user ${userId}:`, error);
      // Don't throw - this shouldn't block authentication
    }
  }

  /**
   * Ensure user is added to the workspace's general channel
   */
  private async ensureUserInGeneralChannel(user: User): Promise<void> {
    try {
      logger.info(
        `[GENERAL_CHANNEL] Checking general channel membership for user ${user.email} (${user.id})`
      );

      const channelId = await joinUserToGeneralChannel(
        this.prisma,
        user.workspaceId!,
        user.id,
        ChannelRole.MEMBER
      );

      if (channelId) {
        logger.info(`[GENERAL_CHANNEL] ✅ Successfully added user ${user.email} to general channel ${channelId}`);
      } else {
        logger.warn(`[GENERAL_CHANNEL] ❌ General channel not found in workspace ${user.workspaceId}`);
      }
    } catch (channelError) {
      logger.error(
        `[GENERAL_CHANNEL] ❌ Failed to add user ${user.email} to general channel:`,
        channelError
      );
      // Don't throw - this shouldn't block authentication
    }
  }

  /**
   * Find existing user or create new one from Google OAuth data
   * This is the main method used by the auth middleware
   * Returns both the user and a flag indicating if the user was newly created
   */
  async findOrCreateUser(googleUserData: GoogleUserData, workspaceId: string): Promise<{ user: UserWithOrgRole; isNewUser: boolean }> {
    try {
      // First, try to find user by Google ID
      let user = await this.findUserByGoogleId(googleUserData.googleId, workspaceId);
      let isNewUser = false;

      if (user) {
        // User exists, check if we need to update any information
        const needsUpdate =
          user.email !== googleUserData.email ||
          user.name !== googleUserData.name ||
          user.picture !== googleUserData.picture;

        if (needsUpdate) {
          logger.info(`Updating user info for: ${user.email}`);
          user = await this.updateUser(user.id, {
            email: googleUserData.email,
            name: googleUserData.name,
            picture: googleUserData.picture,
          });
        }

        // Fetch org role
        const orgRole = await this.getOrgRole(user.orgMemberId);
        if (!orgRole) throw new Error(`orgRole not found for user ${user.id}`);

        return { user: { ...user, orgRole }, isNewUser };
      }

      // User doesn't exist with this Google ID, check by email
      user = await this.findUserByEmail(googleUserData.email, workspaceId);

      if (user) {
        // User exists with this email but different Google ID
        // This can happen if user previously used a different Google account
        logger.info(
          `Linking existing email ${googleUserData.email} to Google ID ${googleUserData.googleId}`
        );
        user = await this.updateUser(user.id, {
          googleId: googleUserData.googleId,
          name: googleUserData.name,
          picture: googleUserData.picture,
        });

        // Fetch org role
        const orgRole = await this.getOrgRole(user.orgMemberId);
        if (!orgRole) throw new Error(`orgRole not found for user ${user.id}`);

        return { user: { ...user, orgRole }, isNewUser };
      }

      // User doesn't exist at all, create new user
      logger.info(`Creating new user for: ${googleUserData.email}`);
      user = await this.createUser(googleUserData, workspaceId);
      isNewUser = true;

      // Fetch org role for new user
      const orgRole = await this.getOrgRole(user.orgMemberId);
      if (!orgRole) throw new Error(`orgRole not found for user ${user.id}`);

      // Note: ensureUserPresence is called in createUser(), so no need to call it here

      return { user: { ...user, orgRole }, isNewUser };
    } catch (error) {
      logger.error('Error in findOrCreateUser:', error);
      throw new Error('Failed to find or create user');
    }
  }

  /**
   * Find existing user or create new one from OAuth data (provider-agnostic)
   * This method supports multiple OAuth providers (Google, Microsoft, etc.)
   * Returns both the user and a flag indicating if the user was newly created
   */
  async findOrCreateOAuthUser(
    oauthUserData: OAuthUserData,
    workspaceId: string
  ): Promise<{ user: User; isNewUser: boolean }> {
    try {
      return await this.createOrGetWorkspaceUser({
        providerUserId: oauthUserData.providerUserId,
        email: oauthUserData.email,
        name: oauthUserData.name,
        picture: oauthUserData.picture,
        workspaceId,
        authProvider: oauthUserData.provider,
      });
    } catch (error) {
      logger.error('Error in findOrCreateOAuthUser:', error);
      throw new Error('Failed to find or create user');
    }
  }

  /**
   * Get user by ID with org member data
   */
  async getUserById(userId: string): Promise<(User & { orgMember: { memberId: string; role: string } }) | null> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });
      
      if (!user) {
        return null;
      }
      
      // Fetch org member separately since there's no explicit relation
      const orgMember = await this.prisma.orgMember.findUnique({
        where: { memberId: user.orgMemberId },
        select: {
          memberId: true,
          role: true,
        },
      });

      if (!orgMember) {
        logger.warn(`getUserById: orgMember not found for user ${userId}`);
        return null;
      }

      return {
        ...user,
        orgMember,
      };
    } catch (error) {
      logger.error('Error getting user by ID:', error);
      throw new Error('Failed to get user');
    }
  }

  /**
   * Get user statistics
   */
  async getUserStats(userId: string) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        return null;
      }

      // Manually count tickets (no FK relations)
      const totalCreated = await this.prisma.ticket.count({
        where: { createdBy: userId },
      });

      const totalUpdated = await this.prisma.ticket.count({
        where: { updatedBy: userId },
      });

      // Calculate ticket status distribution efficiently in the database
      const statusGroups = await this.prisma.ticket.groupBy({
        by: ['status'],
        where: { createdBy: userId },
        _count: {
          status: true,
        },
      });

      const statusCounts = statusGroups.reduce(
        (acc: Record<string, number>, group) => {
          acc[group.status] = group._count.status;
          return acc;
        },
        {} as Record<string, number>
      );

      return {
        totalCreated,
        totalUpdated,
        statusDistribution: statusCounts,
      };
    } catch (error) {
      logger.error('Error getting user stats:', error);
      throw new Error('Failed to get user statistics');
    }
  }

  /**
   * Store refresh token for a user (deprecated - use UserSessionService instead)
   * @deprecated Use UserSessionService.createSession() instead
   */
  async storeRefreshToken(
    userId: string,
    _refreshToken: string | null,
    _expiryDate?: Date
  ): Promise<User> {
    try {
      // Update user's last activity time
      const user = await this.prisma.user.update({
        where: { id: userId },
        data: {
          updatedAt: new Date(),
        },
      });

      logger.info(
        `storeRefreshToken called for user: ${user.email} (${user.id}) - use UserSessionService instead`
      );
      return user;
    } catch (error) {
      logger.error('Error in storeRefreshToken:', error);
      throw new Error('Failed to store refresh token');
    }
  }

  /**
   * Get user by refresh token (deprecated - use UserSessionService instead)
   * @deprecated Use UserSessionService.getSessionByRefreshToken() instead
   */
  async getUserByRefreshToken(_refreshToken: string): Promise<User | null> {
    try {
      logger.info(
        'getUserByRefreshToken called - use UserSessionService.getSessionByRefreshToken() instead'
      );
      return null;
    } catch (error) {
      logger.error('Error getting user by refresh token:', error);
      throw new Error('Failed to get user by refresh token');
    }
  }

  /**
   * Invalidate refresh token for a user (deprecated - use UserSessionService instead)
   * @deprecated Use UserSessionService.revokeAllUserSessions() instead
   */
  async invalidateRefreshToken(userId: string): Promise<void> {
    try {
      logger.info(
        `invalidateRefreshToken called for user ID: ${userId} - use UserSessionService.revokeAllUserSessions() instead`
      );
    } catch (error) {
      logger.error('Error invalidating refresh token:', error);
      throw new Error('Failed to invalidate refresh token');
    }
  }

  /**
   * Get all workspaces for an email address
   * Used during workspace selection flow (no auth user yet)
   */
  async getWorkspacesByEmail(email: string): Promise<Array<{
    id: string;
    name: string;
    role: string;
    orgId: string;
    orgName: string;
    workspaceType: string | null;
    memberCount: number;
  }>> {
    try {
      return await runAsSystem(async () => {
        logger.info(`[getWorkspacesByEmail] Querying workspaces for email: ${email}`);
        const workspaceUsers = await this.prisma.user.findMany({
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

        const approvedJoinRequests = await this.prisma.workspaceJoinRequest.findMany({
          where: {
            email: { equals: email, mode: 'insensitive' },
            status: WorkspaceJoinRequestStatus.APPROVED,
          },
          orderBy: { updatedAt: 'desc' },
        });

        const approvedJoinRequestWorkspaces = approvedJoinRequests.length > 0
          ? await this.prisma.workspace.findMany({
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

        const memberCounts = await this.prisma.user.groupBy({
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
      });
    } catch (error) {
      logger.error('Error getting workspaces by email:', error);
      throw new Error('Failed to get workspaces');
    }
  }

  /**
   * Check if user exists in the system but has no active workspace memberships
   * Used to show appropriate message when user was removed from all workspaces
   */
  async userExistsButNoActiveWorkspaces(email: string): Promise<boolean> {
    try {
      const userCount = await this.prisma.user.count({
        where: {
          email: { equals: email, mode: 'insensitive' },
        },
      });

      const activeCount = await this.prisma.user.count({
        where: {
          email: { equals: email, mode: 'insensitive' },
          status: UserStatus.ACTIVE,
          leftAt: null,
        },
      });

      return userCount > 0 && activeCount === 0;
    } catch (error) {
      logger.error('Error checking user workspace status:', error);
      return false;
    }
  }

  /**
   * Create or get workspace-scoped user record
   * Called after temp token is verified
   */
  async createOrGetWorkspaceUser(userData: {
    providerUserId?: string | null;
    email: string;
    name: string;
    picture?: string | null;
    workspaceId: string;
    authProvider?: string;
  }): Promise<{ user: User; isNewUser: boolean }> {
    try {
      // Try to find existing workspace user by providerUserId (only when available)
      let workspaceUser: User | null = null;
      if (userData.providerUserId) {
        workspaceUser = await this.prisma.user.findUnique({
          where: {
            providerUserId_workspaceId: {
              providerUserId: userData.providerUserId,
              workspaceId: userData.workspaceId
            }
          }
        });
      }

      const normalizedAuthProvider = (userData.authProvider?.toUpperCase() as AuthProvider) || AuthProvider.GOOGLE;
      const hasCompletedOnboarding = await this.hasCompletedOnboarding(userData.email, workspaceUser?.id);

      if (workspaceUser) {
        workspaceUser = await this.prisma.user.update({
          where: { id: workspaceUser.id },
          data: { authProvider: normalizedAuthProvider }
        });
        return { user: workspaceUser, isNewUser: !hasCompletedOnboarding };
      }

      // Also check by email (for users created by seed script or when providerUserId is unavailable)
      // workspaceUser = await this.prisma.user.findUnique({
      //   where: {
      //     email_workspaceId: {
      //       email: userData.email,
      //       workspaceId: userData.workspaceId
      //     }
      //   }
      // });

      // if (workspaceUser) {
      //   workspaceUser = await this.prisma.user.update({
      //     where: { id: workspaceUser.id },
      //     data: {
      //       ...(userData.providerUserId ? { providerUserId: userData.providerUserId } : {}),
      //       authProvider: normalizedAuthProvider
      //     }
      //   });
      //   return { user: workspaceUser, isNewUser: false };
      // }

      // Get workspace to check org membership
      const workspace = await this.prisma.workspace.findUnique({
        where: { id: userData.workspaceId },
        include: { organization: true }
      });

      if (!workspace) {
        throw new Error('Workspace not found');
      }

      // A live, unconsumed invitation for this workspace. Revoking sets the expiry to the
      // moment of revocation, so one comparison covers both a lapsed invitation and a
      // withdrawn one. An already-accepted invitation is not a second entry: whoever used it
      // holds an account in the workspace and is resolved before this point.
      const invitation = await this.prisma.invitation.findFirst({
        where: {
          workspaceId: userData.workspaceId,
          email: { equals: userData.email, mode: 'insensitive' },
          acceptedAt: null,
          expiredAt: { gt: new Date() }
        }
      });

      // Entry to a workspace comes from an invitation to that workspace, or an approved join
      // request for it. Holding an account in another workspace of the same organisation is
      // not itself entry to this one.
      const hasAccess = !!invitation;
      const approvedJoinRequest = await this.prisma.workspaceJoinRequest.findFirst({
        where: {
          workspaceId: userData.workspaceId,
          email: { equals: userData.email, mode: 'insensitive' },
          status: WorkspaceJoinRequestStatus.APPROVED,
        },
        orderBy: { updatedAt: 'desc' },
      });

      if (!hasAccess && !approvedJoinRequest) {
        throw new Error('User does not have access to this workspace');
      }

      const role = invitation?.role || 'MEMBER';

      // Fetch existing orgMember by email
      let orgMember = await this.prisma.orgMember.findFirst({
        where: { email: { equals: userData.email, mode: 'insensitive' } },
        select: { memberId: true }
      });

      if (!orgMember && approvedJoinRequest) {
        orgMember = await this.prisma.orgMember.create({
          data: {
            orgId: workspace.orgId,
            email: userData.email,
            role: OrgRole.MEMBER,
            leftAt: null,
          },
          select: { memberId: true },
        });
      }

      if (!orgMember) {
        throw new Error(`orgMember not found for email ${userData.email}. User must be invited to the organization first.`);
      }

      if (!userData.providerUserId) {
        throw new Error(`providerUserId is required to create a new workspace user for ${userData.email}`);
      }

      workspaceUser = await this.prisma.user.create({
        data: {
          providerUserId: userData.providerUserId,
          email: userData.email,
          name: userData.name,
          picture: userData.picture,
          authProvider: normalizedAuthProvider,
          workspace: { connect: { id: userData.workspaceId } },
          role,
          orgMember: { connect: { memberId: orgMember.memberId } },
        }
      });

      try {
        await aiProvisioningService.enqueueUserSync(workspaceUser.orgMemberId);
      } catch (error) {
        logger.error('[UserService] Failed to enqueue AI user provisioning for workspace user', {
          userId: workspaceUser.id,
          workspaceId: workspaceUser.workspaceId,
          orgMemberId: workspaceUser.orgMemberId,
          error,
        });
      }

      // Grant permissions based on invitation role (fixes V2 auth zero-permissions bug)
      await grantPermissionsForRole(workspaceUser.id, workspaceUser.email, role as WorkspaceRole, userData.workspaceId);

      // Join the workspace's general channel (creates it when missing, e.g. legacy
      // enterprise workspaces that predate the general-channel default)
      await ensureGeneralChannelForWorkspace({
        db: this.prisma,
        workspaceId: userData.workspaceId,
        workspaceName: workspace.name,
        createdBy: workspace.createdBy || workspaceUser.id,
        userId: workspaceUser.id,
        role: ChannelRole.MEMBER,
      });

      logger.info(`Created workspace user for ${userData.email} in workspace ${userData.workspaceId}`);
      return { user: workspaceUser, isNewUser: !hasCompletedOnboarding };
    } catch (error) {
      logger.error('Error creating workspace user:', error);
      throw error instanceof Error ? error : new Error('Failed to create workspace user');
    }
  }

  /**
   * Check Redis for a verified email-password registration's passwordHash.
   * Returns { passwordHash } if found, so it can be set on the OrgMember
   * during org creation. Cleans up the Redis key after reading.
   */
  private async getVerifiedPasswordHash(email: string): Promise<{ passwordHash?: string }> {
    try {
      const raw = await redisService.get(`emailreg:verified:${email.toLowerCase().trim()}`);
      if (!raw) return {};
      const data = JSON.parse(raw) as { passwordHash?: string };
      await redisService.del(`emailreg:verified:${email.toLowerCase().trim()}`);
      return data.passwordHash ? { passwordHash: data.passwordHash } : {};
    } catch {
      return {};
    }
  }

  /**
   * Create organization with default workspace and user
   * Called after temp token is verified
   */
  async createOrganizationWithUser(
    userData: {
      providerUserId: string;
      email: string;
      name: string;
      picture?: string | null;
    },
    orgName: string,
    workspaceName: string,
    authProvider: string = 'GOOGLE'
  ): Promise<{ organization: any; workspace: any; workspaceUser: User; isNewUser: boolean }> {
    try {
      await organizationDomainService.assertCanCreateOrgForEmail(userData.email);

      // Check if organization already exists
      const existingOrg = await this.prisma.organization.findUnique({
        where: { name: orgName }
      });

      if (existingOrg) {
        throw new Error(`Organization with name "${orgName}" already exists. Please choose a different name.`);
      }

      const orgId = createId();
      await getEncryptionProvider().initializeOrg(orgId);

      const { organization, workspace } = await this.prisma.$transaction(async (tx) => {
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

      // Step 3: Link workspace to organization
      await this.prisma.workspaceOrganization.create({
        data: {
          orgId: organization.orgId,
          workspaceId: workspace.id,
          role: WorkspaceRole.ADMIN
        }
      });

      // Step 4: Add/upgrade user as OrgMember first so they can create additional workspaces later.
      // A COMMUNITY_MEMBER row is the only global OrgMember row public users have before
      // joining/creating an enterprise workspace. Move that row to the enterprise org.
      const hasCompletedOnboarding = await this.hasCompletedOnboarding(userData.email);

      const existingOrgMember = await this.prisma.orgMember.findUnique({
        where: { email: userData.email },
      });

      if (existingOrgMember && existingOrgMember.role !== (OrgRole.COMMUNITY_MEMBER as any)) {
        throw new Error(`User ${userData.email} already belongs to an organization`);
      }

      const orgMember = existingOrgMember
        ? await this.prisma.orgMember.update({
            where: { memberId: existingOrgMember.memberId },
            data: {
              orgId: organization.orgId,
              role: OrgRole.OWNER,
              leftAt: null,
              ...(existingOrgMember.passwordHash ? {} : await this.getVerifiedPasswordHash(userData.email)),
            },
          })
        : await this.prisma.orgMember.create({
            data: {
              orgId: organization.orgId,
              email: userData.email,
              role: OrgRole.OWNER,
              ...(await this.getVerifiedPasswordHash(userData.email)),
            }
          });

      if (existingOrgMember?.role === (OrgRole.COMMUNITY_MEMBER as any)) {
        await aiProvisioningService.upgradeCommunityToEnterpriseBudget(orgMember.memberId);
      }

      // Step 5: Create workspace user as OWNER
      const workspaceUser = await this.prisma.user.create({
        data: {
          providerUserId: userData.providerUserId,
          email: userData.email,
          name: userData.name,
          picture: userData.picture,
          authProvider: authProvider as AuthProvider,
          workspace: { connect: { id: workspace.id } },
          role: WorkspaceRole.OWNER,
          orgMember: { connect: { memberId: orgMember.memberId } },
        }
      });

      // Step 6: Update organization and workspace with correct createdBy (actual user ID)
      await this.prisma.organization.update({
        where: { orgId: organization.orgId },
        data: { createdBy: workspaceUser.id }
      });

      await this.prisma.workspace.update({
        where: { id: workspace.id },
        data: { createdBy: workspaceUser.id }
      });

      await organizationDomainService.createDomainMappingForOrg({
        orgId: organization.orgId,
        email: userData.email,
        verifiedByUserId: workspaceUser.id,
      });

      // Step 7: Create DM project for the workspace with correct createdBy
      await this.prisma.project.create({
        data: {
          name: 'Direct Messages',
          code: 'DM',
          description: 'DM project for direct message channels',
          type: ProjectType.DM,
          workspaceId: workspace.id,
          createdBy: workspaceUser.id,
        }
      });

      // Step 8: Create default project with general channel and board/stages
      const defaults = await createCommunityWorkspaceDefaults({
        db: this.prisma,
        workspaceId: workspace.id,
        workspaceName,
        createdBy: workspaceUser.id,
      });
      await repositories.channelParticipants.addParticipant(defaults.channel.id, workspaceUser.id, ChannelRole.ADMIN);

      // Grant full owner resource access to the workspace owner
      await grantPermissionsForRole(workspaceUser.id, workspaceUser.email, WorkspaceRole.OWNER, workspace.id);

      // Grant ORGANIZATIONS ADMIN access to the org owner (same path the org-members
      // updateRole mutator uses when a member is promoted to ADMIN/OWNER)
      await syncOrgResourceAdminAccess(organization.orgId, userData.email, true, workspaceUser.id);

      // Sync all hardcoded bots into the new workspace
      await unifiedBotUserService.syncAllBotUsers(workspace.id);

      try {
        await aiProvisioningService.enqueueOrgSync(organization.orgId);
        await aiProvisioningService.enqueueWorkspaceSync(workspace.id);
        await aiProvisioningService.enqueueUserSync(workspaceUser.orgMemberId);
      } catch (error) {
        logger.error('[UserService] Failed to enqueue AI provisioning jobs for new organization', {
          orgId: organization.orgId,
          workspaceId: workspace.id,
          userId: workspaceUser.id,
          error,
        });
      }

      logger.info(`Created organization ${orgName} with workspace ${workspaceName} for ${userData.email}`);
      return { organization, workspace, workspaceUser, isNewUser: !hasCompletedOnboarding };
    } catch (error) {
      logger.error('Error creating organization:', error);
      if (isOrganizationPolicyError(error) || (error as Error & { statusCode?: number }).statusCode) {
        throw error;
      }
      throw new Error('Failed to create organization');
    }
  }

  /**
   * Create a new workspace under the user's existing organization.
   * Looks up the user's org via OrgMember, then creates the workspace.
   */
  async createWorkspaceInOrg(
    userData: {
      userId: string;
      providerUserId: string;
      email: string;
      name: string;
      picture?: string | null;
    },
    workspaceName: string,
    options?: {
      workspaceType?: WorkspaceTypeValue;
      joinPolicy?: WorkspaceJoinPolicyValue;
    },
  ): Promise<{ organization: any; workspace: any; workspaceUser: User }> {
    // Find the user's org membership
    const orgMember = await this.prisma.orgMember.findFirst({
      where: { email: userData.email },
      include: { organization: true },
      orderBy: { joinedAt: 'asc' },
    });

    if (!orgMember) {
      throw new Error('No organization found for this user. Create an organization first.');
    }

    const org = orgMember.organization;
    const workspaceType = options?.workspaceType ?? WorkspaceType.ENTERPRISE;
    const joinPolicy =
      workspaceType === WorkspaceType.COMMUNITY
        ? (options?.joinPolicy ?? WorkspaceJoinPolicy.OPEN)
        : WorkspaceJoinPolicy.INVITE_ONLY;

    if (workspaceType === WorkspaceType.COMMUNITY) {
      if (orgMember.role !== OrgRole.OWNER && orgMember.role !== OrgRole.ADMIN) {
        this.raiseWorkspaceCreateError('Only organization owners and admins can create community workspaces', 403);
      }
    }

    // Creating a workspace is inherently cross-tenant: the row being created/updated can
    // never satisfy "must belong to the caller's current workspace" (there is no current
    // workspace for something that doesn't exist yet). Bootstrap it as `system` — every
    // write below already carries its own workspaceId explicitly, so nothing relies on the
    // ambient-context stamper this bypasses. See WorkspacesACL.getMutateWhere / runAsSystem.
    return runAsSystem(async () => {
      // Step 1: Create workspace under existing org with temporary createdBy
      let workspace;
      try {
        workspace = await this.prisma.$transaction(async (tx) => {
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
          this.raiseWorkspaceCreateError('A workspace with this name already exists. Please choose a different name.', 409);
        }
        throw error;
      }

      // Step 2: Link workspace to organization
      await this.prisma.workspaceOrganization.create({
        data: {
          orgId: org.orgId,
          workspaceId: workspace.id,
          role: WorkspaceRole.ADMIN,
        },
      });

      // Step 3: Fetch orgMember for the user (reuse existing orgMember if available)
      const userOrgMember = orgMember || await this.prisma.orgMember.findUnique({
        where: { email: userData.email },
        select: { memberId: true }
      });

      if (!userOrgMember) {
        throw new Error(`orgMember not found for email ${userData.email}. User must be added to the organization first.`);
      }

      // Step 4: Create workspace-scoped user as OWNER
      const workspaceUser = await this.prisma.user.create({
        data: {
          providerUserId: userData.providerUserId,
          email: userData.email,
          name: userData.name,
          picture: userData.picture,
          authProvider: AuthProvider.GOOGLE,
          workspace: { connect: { id: workspace.id } },
          role: WorkspaceRole.OWNER,
          orgMember: { connect: { memberId: orgMember.memberId } },
        },
      });

      // Step 5: Update workspace with correct createdBy (actual user ID)
      await this.prisma.workspace.update({
        where: { id: workspace.id },
        data: { createdBy: workspaceUser.id }
      });

      // Step 6: Create DM project for the workspace with correct createdBy
      await this.prisma.project.create({
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
        db: this.prisma,
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
    });
  }

  /**
   * Clean up - close Prisma connection
   */
  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }

  private raiseWorkspaceCreateError(message: string, statusCode: number): never {
    const error = new Error(message) as Error & { statusCode?: number };
    error.statusCode = statusCode;
    throw error;
  }
}
