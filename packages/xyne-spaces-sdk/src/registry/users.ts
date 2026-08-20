/**
 * Users Operation Registry
 *
 * Maps SDK user methods to backend operations.
 */

import { api, query } from './types.js';
import type { CurrentUser, User, UserProfile } from '../types/index.js';

/**
 * User operations registry.
 *
 * Most operations use Zero queries via /zero/query-fallback.
 * Each entry maps an SDK method to the corresponding backend operation.
 */
export const usersOperations = {
  /**
   * Identify the user this client acts as.
   * Maps to: GET /api/sdk/me
   */
  me: api<void, CurrentUser>('GET', '/api/sdk/me'),

  /**
   * Get all users in workspace.
   * Maps to: Zero query 'getUsers'
   */
  list: query<{ updatedAt?: number } | undefined, User[]>('getUsers'),

  /**
   * Get users with only basic fields (no presence).
   * Maps to: Zero query 'getUsersV2'
   */
  listBasic: query<{ updatedAt?: number } | undefined, User[]>('getUsersV2'),

  /**
   * Get user profiles by user IDs.
   * Maps to: Zero query 'getUserProfilesByIds'
   */
  getProfiles: query<{ userIds: string[] }, UserProfile[]>('getUserProfilesByIds'),

  /**
   * Get a single user profile.
   * Maps to: Zero query 'getUserProfile'
   */
  getProfile: query<{ userId: string }, UserProfile | null>('getUserProfile'),
} as const;
