import { logger } from '@/utils/logger';
import { repositories } from '@/database/repositories';
import { UserResponse } from '../types';
import { withWorkspaceScope } from '@/database/tenant/context';

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
      activityStatus: user.activityStatus ?? null,
    };
  } catch (error) {
    logger.error('[USER-UTILS] Error fetching user data:', error);
    throw error;
  }
}

/**
 * Status fields an app can set on its own app user.
 *
 * Status lives on two tables: `users` (the read path used by getUsers /
 * app APIs) and `user_presence` (the legacy source the Zero mutator still
 * upserts). Both are written here so a REST-set status matches what the
 * dashboard mutator would have produced.
 */
export interface SetUserStatusInput {
  statusEmoji?: string | null;
  statusContent?: string | null;
  /** Relative TTL in seconds. Mutually exclusive with expiresAt. */
  durationSeconds?: number;
  /** Absolute expiry as epoch milliseconds. Mutually exclusive with durationSeconds. */
  expiresAt?: number;
}

export interface UserStatusResponse {
  userId: string;
  statusEmoji: string | null;
  statusContent: string | null;
  statusExpiryAt: Date | null;
}

/**
 * Decodes and validates a status emoji the same way the Zero
 * `userPresence.upsert` mutator does, so both write paths agree.
 */
function validateStatusEmoji(statusEmoji: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(statusEmoji);
  } catch (error) {
    if (error instanceof URIError) {
      throw new Error('Invalid emoji encoding');
    }
    throw error;
  }
  if (!decoded.trim() || decoded.length > 100) {
    throw new Error('Invalid emoji encoding');
  }
  return decoded;
}

async function writeStatus(
  userId: string,
  workspaceId: string,
  data: {
    statusEmoji: string | null;
    statusContent: string | null;
    statusExpiryAt: Date | null;
  },
): Promise<UserStatusResponse> {
  const now = new Date();

  const updatedUser = await withWorkspaceScope(async () => {
    const user = await repositories.users.update(userId, {
      statusEmoji: data.statusEmoji,
      statusContent: data.statusContent,
      statusExpiryAt: data.statusExpiryAt,
      updatedAt: now,
    });

    // Keep the deprecated presence mirror in sync with the users row.
    await repositories.userPresence.upsertStatusByUserId(userId, workspaceId, data, now);

    return user;
  });

  return {
    userId: updatedUser.id,
    statusEmoji: updatedUser.statusEmoji ?? null,
    statusContent: updatedUser.statusContent ?? null,
    statusExpiryAt: updatedUser.statusExpiryAt ?? null,
  };
}

/**
 * Sets the status of the calling app's own user, optionally with an expiry.
 *
 * Expiry is advisory: nothing clears the row when it passes. Readers treat an
 * elapsed `statusExpiryAt` as "no status" (see dashboard `isStatusExpired`),
 * and the app can clear it explicitly via clearUserStatus.
 */
export async function setUserStatus(
  userId: string,
  workspaceId: string,
  input: SetUserStatusInput,
): Promise<UserStatusResponse> {
  try {
    if (input.durationSeconds !== undefined && input.expiresAt !== undefined) {
      throw new Error('Provide only one of durationSeconds or expiresAt');
    }

    const statusEmoji =
      input.statusEmoji != null && input.statusEmoji !== ''
        ? validateStatusEmoji(input.statusEmoji)
        : null;
    const statusContent =
      input.statusContent != null && input.statusContent !== ''
        ? input.statusContent
        : null;

    if (!statusEmoji && !statusContent) {
      throw new Error('At least one of statusEmoji or statusContent is required');
    }

    let statusExpiryAt: Date | null = null;
    if (input.durationSeconds !== undefined) {
      statusExpiryAt = new Date(Date.now() + input.durationSeconds * 1000);
    } else if (input.expiresAt !== undefined) {
      statusExpiryAt = new Date(input.expiresAt);
      if (statusExpiryAt.getTime() <= Date.now()) {
        throw new Error('expiresAt must be in the future');
      }
    }

    const result = await writeStatus(userId, workspaceId, {
      statusEmoji,
      statusContent,
      statusExpiryAt,
    });

    logger.info(
      `[USER-UTILS] Status set for user ${userId} (expiry: ${statusExpiryAt?.toISOString() ?? 'none'})`,
    );
    return result;
  } catch (error) {
    logger.error('[USER-UTILS] Error setting user status:', error);
    throw error;
  }
}

/** Clears emoji, text and expiry for the calling app's own user. Idempotent. */
export async function clearUserStatus(
  userId: string,
  workspaceId: string,
): Promise<UserStatusResponse> {
  try {
    const result = await writeStatus(userId, workspaceId, {
      statusEmoji: null,
      statusContent: null,
      statusExpiryAt: null,
    });
    logger.info(`[USER-UTILS] Status cleared for user ${userId}`);
    return result;
  } catch (error) {
    logger.error('[USER-UTILS] Error clearing user status:', error);
    throw error;
  }
}
