/**
 * Workspace Operation Registry
 *
 * Shared workspace-level items that do not belong to a larger domain: shared
 * links, connected repositories, custom emoji, lookup values, merchants, and
 * the classification mappings that route categorised mail to a team.
 */

import { op } from './types.js';
import type {
  Channel,
  LinkVisibility,
  ClassificationMapping,
  CustomEmoji,
  LookupType,
  LookupValue,
  Merchant,
  Repo,
  SdlcTrack,
  SdlcTrackStatus,
  TicketTag,
} from '../types/index.js';

export const workspaceOperations = {
  // ----- Links -----

  /**
   * Create a shared link in a channel.
   */
  createLink: op<{
      id: string;
      url: string;
      title: string;
      channelId: string;
      visibility: LinkVisibility;
      description?: string;
      favicon?: string;
    }, void>('workspace.createLink', 'mutator'),

  /**
   * Update a shared link.
   */
  updateLink: op<{
      id: string;
      title?: string;
      description?: string;
      favicon?: string;
      visibility?: LinkVisibility;
    }, void>('workspace.updateLink', 'mutator'),

  /**
   * Delete a shared link.
   */
  deleteLink: op<{ id: string }, void>('workspace.deleteLink', 'mutator'),

  /**
   * Share a link with specific users.
   */
  shareLink: op<{ linkId: string; userIds: string[]; accessIds: string[] }, void>('workspace.shareLink', 'mutator'),

  /**
   * Stop sharing a link with someone.
   */
  unshareLink: op<{ linkId: string; userId: string }, void>('workspace.unshareLink', 'mutator'),

  // ----- Repositories -----

  /**
   * Connected repositories.
   */
  listRepos: op<void, Repo[]>('workspace.listRepos', 'query'),

  /**
   * Connect a repository.
   */
  createRepo: op<{ id: string; name: string; url: string; baseBranch: string[]; prefix: string }, void>('workspace.createRepo', 'mutator'),

  /**
   * Update a repository's details.
   */
  updateRepo: op<{ id: string; name?: string; url?: string; baseBranch?: string[]; prefix?: string }, void>('workspace.updateRepo', 'mutator'),

  /**
   * Disconnect a repository.
   */
  deleteRepo: op<{ id: string }, void>('workspace.deleteRepo', 'mutator'),

  /**
   * Track another branch on a repository.
   */
  addRepoBranch: op<{ id: string; branchName: string }, void>('workspace.addRepoBranch', 'mutator'),

  // ----- SDLC -----

  /**
   * One SDLC channel by id, with its participants, stats and canvas folders.
   *
   * Ends in `.one()`, so at most one row; a channel that is not an SDLC hub
   * resolves to null rather than an empty list.
   *
   * Replaces `getSdlcRepoByChannel`. The subsystem was re-keyed from
   * repositories to channels, and `getSdlcRepoByChannelId` no longer exists —
   * the SDLC hub *is* a channel now, so there is no separate repo row to fetch.
   */
  getSdlcChannel: op<{ channelId: string }, Channel | null>('workspace.getSdlcChannel', 'query'),

  /**
   * Tracks belonging to an SDLC channel, oldest first.
   *
   * Keyed by `channelId` since the same re-keying; it took `repoId` before.
   */
  listSdlcTracks: op<{ channelId: string }, SdlcTrack[]>('workspace.listSdlcTracks', 'query'),

  /**
   * Start a track on an SDLC repository.
   *
   * The caller only names the repository and the track; the id and timestamp
   * are generated here, and the id is returned so the new track can be acted
   * on without a re-read. Permission comes from channel participation in the
   * repository's channel.
   */
  createSdlcTrack: op<{ repoId: string; name: string; description?: string }, void>('workspace.createSdlcTrack', 'mutator'),

  /**
   * Change a track's name, description, or status.
   *
   * Only the fields passed are changed. `description` accepts null to clear it.
   */
  updateSdlcTrack: op<{
      trackId: string;
      name?: string;
      description?: string | null;
      status?: SdlcTrackStatus;
    }, void>('workspace.updateSdlcTrack', 'mutator'),

  // ----- Custom emoji -----

  /**
   * Custom emoji in the workspace.
   */
  listEmojis: op<void, CustomEmoji[]>('workspace.listEmojis', 'query'),

  /**
   * One custom emoji by id.
   */
  getEmoji: op<{ emojiId: string }, CustomEmoji | null>('workspace.getEmoji', 'query'),

  /**
   * One custom emoji by name.
   */
  getEmojiByName: op<{ name: string }, CustomEmoji | null>('workspace.getEmojiByName', 'query'),

  // ----- Reference data -----

  /**
   * Lookup values of a given type — the enumerations used across forms and
   * incident records.
   */
  listLookupValues: op<{ type: LookupType }, LookupValue[]>('workspace.listLookupValues', 'query'),

  /**
   * Merchants known to the workspace.
   */
  listMerchants: op<void, Merchant[]>('workspace.listMerchants', 'query'),

  /**
   * Tags defined across projects.
   */
  listTicketTags: op<{ projectId: string }, TicketTag[]>('workspace.listTicketTags', 'query'),

  // ----- Classification routing -----

  /**
   * Rules mapping a mail category to the team that handles it, for one channel.
   */
  listClassificationMappings: op<{ channelId: string }, ClassificationMapping[]>('workspace.listClassificationMappings', 'query'),

  /**
   * Route a category to a team.
   */
  createClassificationMapping: op<{
      id: string;
      channelId: string;
      category: string;
      userGroupId: string;
      subCategory?: string;
    }, void>('workspace.createClassificationMapping', 'mutator'),

  /**
   * Change a routing rule.
   */
  updateClassificationMapping: op<{ id: string; category?: string; subCategory?: string; userGroupId?: string }, void>('workspace.updateClassificationMapping', 'mutator'),

  /**
   * Remove a routing rule.
   */
  deleteClassificationMapping: op<{ id: string }, void>('workspace.deleteClassificationMapping', 'mutator'),
} as const;
