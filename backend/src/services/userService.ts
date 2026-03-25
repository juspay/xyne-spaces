import { PrismaClient, User, AccessType, UserPresenceStatus, AuthProvider } from '@prisma/client';
import { logger } from '../utils/logger';
import { repositories } from '../database/repositories/index';
import { DatabaseClient } from '@/database/client';

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

export class UserService {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = DatabaseClient.getInstance();
  }

  /**
   * Find an existing user by Provider User ID
   */
  async findUserByProviderUserId(providerUserId: string): Promise<User | null> {
    try {
      return await this.prisma.user.findUnique({
        where: { providerUserId },
      });
    } catch (error) {
      logger.error('Error finding user by Provider User ID:', error);
      throw new Error('Failed to find user');
    }
  }

  /**
   * Find an existing user by Google ID (using providerUserId)
   * @deprecated Use findUserByProviderUserId instead
   */
  async findUserByGoogleId(googleId: string): Promise<User | null> {
    return this.findUserByProviderUserId(googleId);
  }

  /**
   * Find an existing user by Provider User ID
   */
  async getUserByProviderUserId(providerUserId: string): Promise<User | null> {
    try {
      return await this.prisma.user.findUnique({
        where: { providerUserId },
      });
    } catch (error) {
      logger.error('Error finding user by Provider User ID:', error);
      throw new Error('Failed to find user');
    }
  }

  /**
   * Find an existing user by email
   */
  async findUserByEmail(email: string): Promise<User | null> {
    try {
      return await this.prisma.user.findUnique({
        where: { email },
      });
    } catch (error) {
      logger.error('Error finding user by email:', error);
      throw new Error('Failed to find user');
    }
  }

  /**
   * Create a new user from OAuth data
   */
  async createUser(userData: OAuthUserData | GoogleUserData): Promise<User> {
    try {
      // Handle both new OAuthUserData format and legacy GoogleUserData format
      const provider = 'provider' in userData ? userData.provider : AuthProvider.GOOGLE;
      const providerUserId = 'provider' in userData ? userData.providerUserId : userData.googleId;

      const user = await this.prisma.user.create({
        data: {
          authProvider: provider,
          providerUserId: providerUserId,
          email: userData.email,
          name: userData.name,
          picture: userData.picture,
        },
      });

      logger.info(
        `Created new user: ${user.email} (${user.id}) without assigning to a default group.`
      );

      // Grant explicit default access to predefined resources
      // This ensures new admin-level resources like USER-MANAGEMENT require explicit grants
      const DEFAULT_USER_RESOURCES = [
        { resourceName: 'TICKETS', accessType: AccessType.WRITE },
        { resourceName: 'WORKFLOWS', accessType: AccessType.WRITE },
        { resourceName: 'AGENTS', accessType: AccessType.WRITE },
        { resourceName: 'MODELS', accessType: AccessType.WRITE },
        { resourceName: 'TOOLS', accessType: AccessType.WRITE },
        { resourceName: 'AGENT-TOOLS-MAPPINGS', accessType: AccessType.WRITE },
        { resourceName: 'EXTERNAL-STEP-RESPONSE', accessType: AccessType.WRITE },
        { resourceName: 'ANALYTICS', accessType: AccessType.WRITE },
        // USER-MANAGEMENT deliberately excluded - requires explicit admin grant
      ];

      try {
        logger.info(
          `Granting default access to ${DEFAULT_USER_RESOURCES.length} resources for new user ${user.email}`
        );

        for (const defaultResource of DEFAULT_USER_RESOURCES) {
          try {
            const resource = await repositories.resources.findByName(defaultResource.resourceName);
            if (resource) {
              await repositories.resourceAccess.grantAccess(
                {
                  userId: user.id,
                  resourceId: resource.id,
                  accessType: defaultResource.accessType,
                },
                user.id
              );
              logger.debug(
                `Granted ${defaultResource.accessType} access to ${defaultResource.resourceName} for user ${user.email}`
              );
            } else {
              logger.warn(
                `Resource ${defaultResource.resourceName} not found in database for user ${user.email}`
              );
            }
          } catch (resourceError) {
            logger.error(
              `Failed to grant ${defaultResource.accessType} access to ${defaultResource.resourceName} for user ${user.email}:`,
              resourceError
            );
          }
        }

        logger.info(`Successfully granted default access to resources for user ${user.email}`);
      } catch (accessError) {
        logger.error(`Failed to grant default access for user ${user.email}:`, accessError);
        // Don't throw here - user creation succeeded, access grant failure shouldn't rollback user creation
      }

      // Add user to general channel
      await this.ensureUserInGeneralChannel(user);

      // Create user presence entry
      await this.ensureUserPresence(user.id);

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
  async ensureUserPresence(userId: string): Promise<void> {
    try {
      const existingPresence = await this.prisma.userPresence.findUnique({
        where: { userId },
      });

      if (!existingPresence) {
        logger.info(`Creating user presence entry for user ${userId}`);
        await this.prisma.userPresence.create({
          data: {
            userId,
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
  async findOrCreateUser(
    googleUserData: GoogleUserData
  ): Promise<{ user: User; isNewUser: boolean }> {
    try {
      // First, try to find user by Google ID
      let user = await this.findUserByGoogleId(googleUserData.googleId);
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

        return { user, isNewUser };
      }

      // User doesn't exist with this Google ID, check by email
      user = await this.findUserByEmail(googleUserData.email);

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

        return { user, isNewUser };
      }

      // User doesn't exist at all, create new user
      logger.info(`Creating new user for: ${googleUserData.email}`);
      user = await this.createUser(googleUserData);
      isNewUser = true;

      // Note: ensureUserPresence is called in createUser(), so no need to call it here

      return { user, isNewUser };
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
    oauthUserData: OAuthUserData
  ): Promise<{ user: User; isNewUser: boolean }> {
    try {
      // First, try to find user by Provider User ID
      let user = await this.findUserByProviderUserId(oauthUserData.providerUserId);
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
          // Update auth provider separately if needed
          if (user.authProvider !== oauthUserData.provider) {
            user = await this.prisma.user.update({
              where: { id: user.id },
              data: { authProvider: oauthUserData.provider },
            });
          }
        }

        return { user, isNewUser };
      }

      // User doesn't exist with this Provider ID, check by email
      user = await this.findUserByEmail(oauthUserData.email);

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
        // Update auth provider
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: { authProvider: oauthUserData.provider },
        });

        return { user, isNewUser };
      }

      // User doesn't exist at all, create new user
      logger.info(`Creating new user for: ${oauthUserData.email} via ${oauthUserData.provider}`);
      user = await this.createUser(oauthUserData);
      isNewUser = true;

      return { user, isNewUser };
    } catch (error) {
      logger.error('Error in findOrCreateOAuthUser:', error);
      throw new Error('Failed to find or create user');
    }
  }

  /**
   * Get user by ID with related data
   */
  async getUserById(userId: string): Promise<User | null> {
    try {
      return await this.prisma.user.findUnique({
        where: { id: userId },
      });
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
   * Clean up - close Prisma connection
   */
  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
