import { logger } from '@/utils/logger';
import { repositories } from '@/database/repositories';
import { UserResponse } from '../types';
import { User } from '@/types/database';

/**
 * Map a User row to the public UserResponse shape returned by the apps user API.
 */
function toUserResponse(user: User): UserResponse {
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    picture: user.picture,
    userType: user.userType,
    status: user.status,
    joined: user.createdAt,
    statusEmoji: user.statusEmoji ?? null,
    statusContent: user.statusContent ?? null,
    statusExpiryAt: user.statusExpiryAt ?? null,
  };
}

/**
 * Get user data by user ID
 *
 * @param userId - User ID to fetch data for (required)
 * @returns User data with name, email, picture, userType, status, and joined date
 */
export async function getUserData(userId: string): Promise<UserResponse> {
  try {
    const user = await repositories.users.findById(userId);

    if (!user) {
      throw new Error('User not found');
    }

    return toUserResponse(user);
  } catch (error) {
    logger.error('[USER-UTILS] Error fetching user data:', error);
    throw error;
  }
}

/**
 * Get user data by email, scoped to a single workspace.
 *
 * Email is only unique per workspace (@@unique([email, workspaceId])), so a
 * workspaceId is required to resolve a user unambiguously. The caller must pass
 * the workspace it is authorized for — never a client-supplied arbitrary
 * workspace — to preserve tenant isolation. The lookup is case-insensitive.
 *
 * @param email - Email address to look up (required)
 * @param workspaceId - Workspace to scope the lookup to (required)
 * @returns User data with name, email, picture, userType, status, and joined date
 */
export async function getUserDataByEmail(
  email: string,
  workspaceId: string,
): Promise<UserResponse> {
  try {
    const user = await repositories.users.findByEmailCaseInsensitive(email, workspaceId);

    if (!user) {
      throw new Error('User not found');
    }

    return toUserResponse(user);
  } catch (error) {
    logger.error('[USER-UTILS] Error fetching user data by email:', error);
    throw error;
  }
}
