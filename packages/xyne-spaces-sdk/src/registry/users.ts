/**
 * Users Operation Registry
 *
 * Maps SDK user methods to backend operations.
 */

import { op, api } from './types.js';
import type { CurrentUser, User, UserProfile } from '../types/index.js';

/**
 * User operations registry.
 *
 * Each entry declares an SDK operation id and its argument and result types.
 */
export const usersOperations = {
  /**
   * Identify the user this client acts as.
   */
  me: api<void, CurrentUser>('GET', '/api/sdk/v1/me'),

  /**
   * Get all users in workspace.
   */
  list: op<{ updatedAt?: number } | undefined, User[]>('users.list', 'query'),

  /**
   * Get users with only basic fields (no presence).
   */
  listBasic: op<{ updatedAt?: number } | undefined, User[]>('users.listBasic', 'query'),

  /**
   * Get user profiles by user IDs.
   */
  getProfiles: op<{ userIds: string[] }, UserProfile[]>('users.getProfiles', 'query'),

  /**
   * Get a single user profile.
   */
  getProfile: op<{ userId: string }, UserProfile | null>('users.getProfile', 'query'),
} as const;
