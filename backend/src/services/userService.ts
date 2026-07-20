import { PrismaClient, User, UserPresenceStatus, AuthProvider, ProjectType, UserStatus, WorkspaceRole } from '@prisma/client';
import { logger } from '../utils/logger';
import { repositories } from '../database/repositories/index';
import { DatabaseClient } from '@/database/client';
import { unifiedBotUserService } from '@/bots/unified/services/unified-bot-user-service.js';
import { grantPermissionsForRole } from './permissionMatrix';
import { USER_PREFERENCE_NOTIFICATION_DEFAULTS } from '@/constants/userPreferenceDefaults';

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
  orgRole?: string;
}

export class UserService {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = DatabaseClient.getInstance();
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
      return await this.prisma.user.findUnique({
        where: { email_workspaceId: { email, workspaceId } }
      });
    } catch (error) {
      logger.error('Error finding user by email:', error);
      throw new Error('Failed to find user');
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
      const orgMember = await this.prisma.orgMember.findUnique({
        where: { email: userData.email },
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

      // grantPermissionsForRole swallows errors internally — user creation must not rollback on grant failure
      await grantPermissionsForRole(user.id, user.email, WorkspaceRole.MEMBER, workspaceId);

      // Add user to general channel
      await this.ensureUserInGeneralChannel(user);

      // Create user presence entry
      await this.ensureUserPresence(user.id, user.workspaceId);

      // Create user preference entry
      await this.ensureUserPreference(user.id);

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
        await this.prisma.userPreference.create({
          data: {
            ...USER_PREFERENCE_NOTIFICATION_DEFAULTS,
            userId,
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
   * Ensure user is added to general channel
   */
  private async ensureUserInGeneralChannel(user: User): Promise<void> {
    try {
      logger.info(
        `[GENERAL_CHANNEL] Checking general channel membership for user ${user.email} (${user.id})`
      );

      // Find the general channel by name
      logger.info(`[GENERAL_CHANNEL] Looking for channel with name 'general'`);
      const generalChannel = await repositories.channels.findByName('general');

      if (generalChannel) {
        // Check if user is already a participant
        const isAlreadyParticipant = await repositories.channelParticipants.isParticipant(
          generalChannel.id,
          user.id
        );

        if (!isAlreadyParticipant) {
          // Add user as a member of the general channel
          logger.info(
            `[GENERAL_CHANNEL] Adding user ${user.email} as MEMBER to channel ${generalChannel.id}`
          );
          const participant = await repositories.channelParticipants.addParticipant(
            generalChannel.id,
            user.id,
            'MEMBER'
          );
          logger.info(
            `[GENERAL_CHANNEL] ✅ Successfully added user ${user.email} to general channel. Participant ID: ${participant.id}`
          );
        } else {
          logger.info(
            `[GENERAL_CHANNEL] ⚠️ User ${user.email} is already a participant in general channel`
          );
        }
      } else {
        logger.warn(`[GENERAL_CHANNEL] ❌ General channel not found in database`);
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
        const orgRole = user.orgMemberId ? await this.getOrgRole(user.orgMemberId) : undefined;

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
        const orgRole = user.orgMemberId ? await this.getOrgRole(user.orgMemberId) : undefined;

        return { user: { ...user, orgRole }, isNewUser };
      }

      // User doesn't exist at all, create new user
      logger.info(`Creating new user for: ${googleUserData.email}`);
      user = await this.createUser(googleUserData, workspaceId);
      isNewUser = true;

      // Fetch org role for new user
      const orgRole = user.orgMemberId ? await this.getOrgRole(user.orgMemberId) : undefined;

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
      // First, try to find user by Provider User ID
      let user = await this.getUserByProviderUserId(oauthUserData.providerUserId, workspaceId);
      let isNewUser = false;

      if (user) {
        // User exists, check if we need to update any information
        const needsUpdate =
          user.email !== oauthUserData.email ||
          user.name !== oauthUserData.name ||
          user.picture !== oauthUserData.picture ||
          user.authProvider !== oauthUserData.provider;

        if (needsUpdate) {
          logger.info(`Updating user info for: ${user.email}`);
          user = await this.updateUser(user.id, {
            email: oauthUserData.email,
            name: oauthUserData.name,
            picture: oauthUserData.picture,
          });
        }
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: { authProvider: oauthUserData.provider },
        });

        return { user, isNewUser };
      }

      // User doesn't exist with this Provider ID, check by email
      user = await this.findUserByEmail(oauthUserData.email, workspaceId);

      if (user) {
        // User exists with this email but different provider
        // This can happen if user previously used a different OAuth provider
        logger.info(
          `Linking existing email ${oauthUserData.email} to ${oauthUserData.provider} ID ${oauthUserData.providerUserId}`
        );
        user = await this.updateUser(user.id, {
          googleId: oauthUserData.providerUserId, // This updates providerUserId via the method
          name: oauthUserData.name,
          picture: oauthUserData.picture,
        });
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: { authProvider: oauthUserData.provider },
        });

        return { user, isNewUser };
      }

      // User doesn't exist at all, create new user
      logger.info(`Creating new user for: ${oauthUserData.email} via ${oauthUserData.provider}`);
      user = await this.createUser(oauthUserData, workspaceId);
      isNewUser = true;

      return { user, isNewUser };
    } catch (error) {
      logger.error('Error in findOrCreateOAuthUser:', error);
      throw new Error('Failed to find or create user');
    }
  }

  /**
   * Get user by ID with org member data
   */
  async getUserById(userId: string): Promise<(User & { orgMember?: { memberId: string; role: string } | null }) | null> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });
      
      if (!user) {
        return null;
      }
      
      // Fetch org member separately since there's no explicit relation
      const orgMember = user.orgMemberId ? await this.prisma.orgMember.findUnique({
        where: { memberId: user.orgMemberId },
        select: {
          memberId: true,
          role: true,
        },
      }) : null;
      
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
  }>> {
    try {
      logger.info(`[getWorkspacesByEmail] Querying workspaces for email: ${email}`);
      const workspaceUsers = await this.prisma.user.findMany({
        where: {
          email,
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

      logger.info(`[getWorkspacesByEmail] Found ${workspaceUsers.length} active workspace users for email: ${email}`);
      workspaceUsers.forEach(u => {
        logger.info(`[getWorkspacesByEmail] - User ${u.id} in workspace ${u.workspace?.id}`);
      });

      // Return flat list of workspaces for frontend
      return workspaceUsers.map(wsUser => ({
        id: wsUser.workspace!.id,
        name: wsUser.workspace!.name,
        role: wsUser.role || 'MEMBER',
        orgId: wsUser.workspace!.organization.orgId,
        orgName: wsUser.workspace!.organization.name
      }));
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
          email,
        },
      });

      const activeCount = await this.prisma.user.count({
        where: {
          email,
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

      if (workspaceUser) {
        workspaceUser = await this.prisma.user.update({
          where: { id: workspaceUser.id },
          data: { authProvider: normalizedAuthProvider }
        });
        return { user: workspaceUser, isNewUser: false };
      }

      // Also check by email (for users created by seed script or when providerUserId is unavailable)
      workspaceUser = await this.prisma.user.findUnique({
        where: {
          email_workspaceId: {
            email: userData.email,
            workspaceId: userData.workspaceId
          }
        }
      });

      if (workspaceUser) {
        workspaceUser = await this.prisma.user.update({
          where: { id: workspaceUser.id },
          data: {
            ...(userData.providerUserId ? { providerUserId: userData.providerUserId } : {}),
            authProvider: normalizedAuthProvider
          }
        });
        return { user: workspaceUser, isNewUser: false };
      }

      // Get workspace to check org membership
      const workspace = await this.prisma.workspace.findUnique({
        where: { id: userData.workspaceId },
        include: { organization: true }
      });

      if (!workspace) {
        throw new Error('Workspace not found');
      }

      // Check if user is invited to this workspace
      const invitation = await this.prisma.invitation.findFirst({
        where: {
          workspaceId: userData.workspaceId,
          email: userData.email
        }
      });

      // Find if there's an existing user with this email in the org
      const existingOrgUsers = await this.prisma.user.findMany({
        where: {
          email: userData.email,
          workspace: {
            orgId: workspace.orgId
          }
        }
      });

      const hasAccess = invitation || existingOrgUsers.length > 0;

      if (!hasAccess) {
        throw new Error('User does not have access to this workspace');
      }

      const role = invitation?.role || 'MEMBER';

      // Fetch existing orgMember by email
      const orgMember = await this.prisma.orgMember.findUnique({
        where: { email: userData.email },
        select: { memberId: true }
      });

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

      // Grant permissions based on invitation role (fixes V2 auth zero-permissions bug)
      await grantPermissionsForRole(workspaceUser.id, workspaceUser.email, role, userData.workspaceId);

      logger.info(`Created workspace user for ${userData.email} in workspace ${userData.workspaceId}`);
      return { user: workspaceUser, isNewUser: true };
    } catch (error) {
      logger.error('Error creating workspace user:', error);
      throw new Error('Failed to create workspace user');
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
      // Check if organization already exists
      const existingOrg = await this.prisma.organization.findUnique({
        where: { name: orgName }
      });

      if (existingOrg) {
        throw new Error(`Organization with name "${orgName}" already exists. Please choose a different name.`);
      }

      // Step 1: Create organization with temporary createdBy (will update later)
      const organization = await this.prisma.organization.create({
        data: {
          name: orgName,
          createdBy: userData.providerUserId, // Temporary: will update after user creation
          status: 'ACTIVE'
        }
      });

      // Step 2: Create workspace with temporary createdBy (will update later)
      const workspace = await this.prisma.workspace.create({
        data: {
          orgId: organization.orgId,
          name: workspaceName,
          createdBy: userData.providerUserId, // Temporary: will update after user creation
          status: 'ACTIVE'
        }
      });

      // Step 3: Link workspace to organization
      await this.prisma.workspaceOrganization.create({
        data: {
          orgId: organization.orgId,
          workspaceId: workspace.id,
          role: 'ADMIN'
        }
      });

      // Step 4: Add user as OrgMember first so they can create additional workspaces later
      const orgMember = await this.prisma.orgMember.create({
        data: {
          orgId: organization.orgId,
          email: userData.email,
          role: 'OWNER',
        }
      });

      // Step 5: Create workspace user as OWNER
      const workspaceUser = await this.prisma.user.create({
        data: {
          providerUserId: userData.providerUserId,
          email: userData.email,
          name: userData.name,
          picture: userData.picture,
          authProvider: authProvider as AuthProvider,
          workspace: { connect: { id: workspace.id } },
          role: 'OWNER',
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

      // Grant full admin resource access to the workspace owner
      await grantPermissionsForRole(workspaceUser.id, workspaceUser.email, WorkspaceRole.OWNER, workspace.id);

      // Sync all hardcoded bots into the new workspace
      await unifiedBotUserService.syncAllBotUsers(workspace.id);

      logger.info(`Created organization ${orgName} with workspace ${workspaceName} for ${userData.email}`);
      return { organization, workspace, workspaceUser, isNewUser: true };
    } catch (error) {
      logger.error('Error creating organization:', error);
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
    workspaceName: string
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

    // Step 1: Create workspace under existing org with temporary createdBy
    const workspace = await this.prisma.workspace.create({
      data: {
        orgId: org.orgId,
        name: workspaceName,
        createdBy: userData.providerUserId, // Temporary: will update after user creation
        status: 'ACTIVE',
      },
    });

    // Step 2: Link workspace to organization
    await this.prisma.workspaceOrganization.create({
      data: {
        orgId: org.orgId,
        workspaceId: workspace.id,
        role: 'ADMIN',
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
        authProvider: 'GOOGLE',
        workspace: { connect: { id: workspace.id } },
        role: 'OWNER',
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

    // Grant full admin resource access to the workspace owner
    await grantPermissionsForRole(workspaceUser.id, workspaceUser.email, WorkspaceRole.OWNER, workspace.id);

    // Sync all hardcoded bots into the new workspace
    await unifiedBotUserService.syncAllBotUsers(workspace.id);

    logger.info(`Created workspace "${workspaceName}" under org "${org.name}" for ${userData.email}`);
    return { organization: org, workspace, workspaceUser };
  }

  /**
   * Clean up - close Prisma connection
   */
  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
