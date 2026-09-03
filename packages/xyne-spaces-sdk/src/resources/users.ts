/**
 * Users Resource
 *
 * The workspace directory, user profiles, and the identity this client acts as.
 */

import { Resource } from './base.js';
import { usersOperations } from '../registry/users.js';
import { paginate, type Page, type PageOptions } from '../core/paginate.js';
import type { CurrentUser, User, UserProfile } from '../types/index.js';

export class UsersResource extends Resource {
  /**
   * Identify the user this client acts as.
   *
   * This is a request rather than a local decode: `role` and `orgRole` are read
   * from the database on each call, so they reflect the user's permissions right
   * now. Cache the result if you need it often — the identity behind a credential
   * does not change.
   *
   * `keyExpiresAt` says when the credential stops working, so a long-running
   * process can renew before it does rather than discovering expiry mid-request.
   *
   * @returns The acting user, their workspace and org, and `keyExpiresAt`.
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
   * The server returns the whole workspace directory in one response, so paging
   * here windows that result rather than saving a round trip. `updatedAt`
   * narrows the fetched set server-side before the window is applied.
   *
   * @param options - Paging window, plus an optional freshness filter.
   * @param options.updatedAt - Only return users changed after this epoch-ms timestamp.
   * @param options.limit - Page size. Defaults to 100, which is also the maximum.
   * @param options.offset - Where the page starts.
   * @returns One page of users, with `hasMore` and `nextOffset` for walking on.
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
   * Same shape as {@link list}, and windowed the same way for the same reason.
   *
   * @param options - Paging window, plus an optional freshness filter.
   * @param options.updatedAt - Only return users changed after this epoch-ms timestamp.
   * @param options.limit - Page size. Defaults to 100, which is also the maximum.
   * @param options.offset - Where the page starts.
   * @returns One page of users, without presence data.
   * @example
   * const page = await sdk.users.listBasic({ limit: 50 });
   */
  async listBasic(options?: { updatedAt?: number } & PageOptions): Promise<Page<User>> {
    const all = await this.call(usersOperations.listBasic, { updatedAt: options?.updatedAt });
    return paginate(all, options);
  }

  /**
   * Get user profiles by their user IDs.
   *
   * @param userIds - Ids to fetch profiles for. Unknown ids are skipped.
   * @returns One profile per user found.
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
   * @param userId - Id of the user.
   * @returns The profile, or `null` if the user has none.
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
