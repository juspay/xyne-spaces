/**
 * Workspace Operation Registry
 *
 * Shared workspace-level items that do not belong to a larger domain: shared
 * links, connected repositories, custom emoji, lookup values, merchants, and
 * the classification mappings that route categorised mail to a team.
 */

import { query, mutator } from './types.js';
import { now } from '../core/ids.js';

export const workspaceOperations = {
  // ----- Links -----

  /**
   * Create a shared link in a channel.
   * Maps to: Zero mutator 'links.create'
   */
  createLink: mutator<
    {
      id: string;
      url: string;
      title: string;
      channelId: string;
      visibility: string;
      description?: string;
      favicon?: string;
    },
    void
  >('links.create', {
    mapArgs: (args) => ({ ...args, createdAt: now(), updatedAt: now() }),
  }),

  /**
   * Update a shared link.
   * Maps to: Zero mutator 'links.update'
   */
  updateLink: mutator<
    {
      id: string;
      title?: string;
      description?: string;
      favicon?: string;
      visibility?: string;
    },
    void
  >('links.update', {
    mapArgs: (args) => ({ ...args, updatedAt: now() }),
  }),

  /**
   * Delete a shared link.
   * Maps to: Zero mutator 'links.delete'
   */
  deleteLink: mutator<{ id: string }, void>('links.delete'),

  /**
   * Share a link with specific users.
   * Maps to: Zero mutator 'links.shareWith'
   */
  shareLink: mutator<{ linkId: string; userIds: string[]; accessIds: string[] }, void>(
    'links.shareWith',
    {
      mapArgs: (args) => ({ ...args, createdAt: now() }),
    }
  ),

  /**
   * Stop sharing a link with someone.
   * Maps to: Zero mutator 'links.unshare'
   */
  unshareLink: mutator<{ linkId: string; userId: string }, void>('links.unshare'),

  // ----- Repositories -----

  /**
   * Connected repositories.
   * Maps to: Zero query 'getAllRepos'
   */
  listRepos: query<void, unknown[]>('getAllRepos'),

  /**
   * Connect a repository.
   * Maps to: Zero mutator 'repo.create'
   */
  createRepo: mutator<
    { id: string; name: string; url: string; baseBranch: string[]; prefix: string },
    void
  >('repo.create'),

  /**
   * Update a repository's details.
   * Maps to: Zero mutator 'repo.update'
   */
  updateRepo: mutator<
    { id: string; name?: string; url?: string; baseBranch?: string[]; prefix?: string },
    void
  >('repo.update'),

  /**
   * Disconnect a repository.
   * Maps to: Zero mutator 'repo.delete'
   */
  deleteRepo: mutator<{ id: string }, void>('repo.delete'),

  /**
   * Track another branch on a repository.
   * Maps to: Zero mutator 'repo.addBranch'
   */
  addRepoBranch: mutator<{ id: string; branchName: string }, void>('repo.addBranch'),

  // ----- Custom emoji -----

  /**
   * Custom emoji in the workspace.
   * Maps to: Zero query 'getAllCustomEmojis'
   */
  listEmojis: query<void, unknown[]>('getAllCustomEmojis'),

  /**
   * One custom emoji by id.
   * Maps to: Zero query 'getCustomEmojiById'
   */
  getEmoji: query<{ emojiId: string }, unknown>('getCustomEmojiById'),

  /**
   * One custom emoji by name.
   * Maps to: Zero query 'getCustomEmojiByName'
   */
  getEmojiByName: query<{ name: string }, unknown>('getCustomEmojiByName'),

  // ----- Reference data -----

  /**
   * Lookup values of a given type — the enumerations used across forms and
   * incident records.
   * Maps to: Zero query 'lookupValuesByType'
   */
  listLookupValues: query<{ type: string }, unknown[]>('lookupValuesByType'),

  /**
   * Merchants known to the workspace.
   * Maps to: Zero query 'getAllMerchants'
   */
  listMerchants: query<void, unknown[]>('getAllMerchants'),

  /**
   * Tags defined across projects.
   * Maps to: Zero query 'getAllTicketTags'
   */
  listTicketTags: query<{ projectId: string }, unknown[]>('getAllTicketTags'),

  // ----- Classification routing -----

  /**
   * Rules mapping a mail category to the team that handles it, for one channel.
   * Maps to: Zero query 'getClassificationMappings'
   */
  listClassificationMappings: query<{ channelId: string }, unknown[]>(
    'getClassificationMappings'
  ),

  /**
   * Route a category to a team.
   * Maps to: Zero mutator 'classificationMapping.create'
   */
  createClassificationMapping: mutator<
    {
      id: string;
      channelId: string;
      category: string;
      userGroupId: string;
      subCategory?: string;
    },
    void
  >('classificationMapping.create', {
    mapArgs: (args) => ({ ...args, createdAt: now() }),
  }),

  /**
   * Change a routing rule.
   * Maps to: Zero mutator 'classificationMapping.update'
   */
  updateClassificationMapping: mutator<
    { id: string; category?: string; subCategory?: string; userGroupId?: string },
    void
  >('classificationMapping.update'),

  /**
   * Remove a routing rule.
   * Maps to: Zero mutator 'classificationMapping.delete'
   */
  deleteClassificationMapping: mutator<{ id: string }, void>(
    'classificationMapping.delete'
  ),
} as const;
