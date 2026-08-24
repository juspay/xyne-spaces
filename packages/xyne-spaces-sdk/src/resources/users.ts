/**
 * Users Resource
 *
 * Provides methods for user-related operations.
 */

import { Resource } from './base.js';
import { usersOperations } from '../registry/users.js';
import { paginate, type Page, type PageOptions } from '../core/paginate.js';
import type { CurrentUser, User, UserProfile } from '../types/index.js';

export class UsersResource extends Resource {
  /**
   * Identify the user this client acts as.
   *
   * An API key is an opaque encrypted blob, not a JWT, so there are no claims to
   * read locally — this is a request. Cache it if you need it often; the identity
   * behind a key does not change.
   *
   * `keyExpiresAt` says when the key stops working, so a long-running process can
   * rotate before it does rather than discovering the expiry mid-request.
   *
   * @example
   * const me = await sdk.users.me();
   * await sdk.tickets.upsertStageRequest({
   *   ticketId, stageId, status: 'APPROVED', updatedBy: me.id,
   * });
   */
  me(): Promise<CurrentUser> {
    return this.call(usersOperations.me, undefined as void);
  }

  /**
   * List users in the workspace, one page at a time.
   *
   * `getUsers` has no server-side cursor — it returns the whole workspace
   * directory in one response — so this fetches that and windows it. Defaults
   * to the first 50. `updatedAt` still narrows the fetched set server-side
   * before paging happens.
   *
   * @param options.updatedAt - Only return users updated after this timestamp (epoch ms)
   *
   * @example
   * const page = await sdk.users.list();
   * for (const user of page.items) {
   *   console.log(user.email);
   * }
   */
  async list(options?: { updatedAt?: number } & PageOptions): Promise<Page<User>> {
    const all = await this.call(usersOperations.list, { updatedAt: options?.updatedAt });
    return paginate(all, options);
  }

  /**
   * List users with basic fields only (no presence data), one page at a time.
   * More efficient when presence status is not needed.
   *
   * Same shape as {@link list} and for the same reason: `getUsersV2` has no
   * server-side cursor.
   *
   * @param options.updatedAt - Only return users updated after this timestamp
   */
  async listBasic(options?: { updatedAt?: number } & PageOptions): Promise<Page<User>> {
    const all = await this.call(usersOperations.listBasic, { updatedAt: options?.updatedAt });
    return paginate(all, options);
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
