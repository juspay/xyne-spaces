/**
 * Users Resource
 *
 * Provides methods for user-related operations.
 */

import { Resource } from './base.js';
import { usersOperations } from '../registry/users.js';
import type { User, UserProfile } from '../types/index.js';

export class UsersResource extends Resource {
  /**
   * List all users in the workspace.
   *
   * @param options.updatedAt - Only return users updated after this timestamp (epoch ms)
   * @returns Array of users
   *
   * @example
   * const users = await sdk.users.list();
   * for (const user of users) {
   *   console.log(user.email);
   * }
   */
  list(options?: { updatedAt?: number }): Promise<User[]> {
    return this.call(usersOperations.list, options);
  }

  /**
   * List users with basic fields only (no presence data).
   * More efficient when presence status is not needed.
   *
   * @param options.updatedAt - Only return users updated after this timestamp
   * @returns Array of users
   */
  listBasic(options?: { updatedAt?: number }): Promise<User[]> {
    return this.call(usersOperations.listBasic, options);
  }

  /**
   * Get user profiles by their user IDs.
   *
   * @param userIds - Array of user IDs to fetch profiles for
   * @returns Array of user profiles
   *
   * @example
   * const profiles = await sdk.users.getProfiles(['user-1', 'user-2']);
   */
  getProfiles(userIds: string[]): Promise<UserProfile[]> {
    return this.call(usersOperations.getProfiles, { userIds });
  }

  /**
   * Get a single user's profile.
   *
   * @param userId - The user ID
   * @returns The user profile, or null if not found
   *
   * @example
   * const profile = await sdk.users.getProfile('user-123');
   * if (profile) {
   *   console.log(profile.bio);
   * }
   */
  getProfile(userId: string): Promise<UserProfile | null> {
    return this.call(usersOperations.getProfile, { userId });
  }
}
