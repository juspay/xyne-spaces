/**
 * Channels Operation Registry
 *
 * Maps SDK channel methods to backend operations.
 *
 * Several mutators here expect the caller to supply row ids and a timestamp —
 * `channelParticipantId`, `channelUserStatusId`, per-user id maps, and the
 * system-message ids that operations like rename and role change post into the
 * channel. Those come from Zero's optimistic-write model and are generated in
 * `mapArgs` so SDK callers never see them.
 */

import { op, api } from './types.js';
import type {
  Channel,
  ChannelParticipant,
  ChannelRole,
  ChannelSection,
  ChannelUserStatus,
  CheckDuplicateChannelResponse,
  CreateChannelInput,
} from '../types/index.js';

export const channelsOperations = {
  // ----- Direct API operations -----

  /**
   * Create a channel and its associated server-owned rows atomically.
   */
  create: api<CreateChannelInput, { id: string }>('POST', '/api/sdk/v1/channels', {
    mapResult: (raw) => {
      const result = raw as { id: string; channelId?: string };
      return { id: result.channelId ?? result.id };
    },
  }),

  /**
   * Check channel-name uniqueness before presenting a create action.
   */
  checkDuplicate: api<
    { name: string; projectId: string },
    CheckDuplicateChannelResponse
  >('POST', '/api/sdk/v1/channels/check-duplicate'),

  // ----- Reads -----

  /**
   * Channels visible to the current user, with channel and stats relations.
   */
  list: op<void, ChannelUserStatus[]>('channels.list', 'query'),

  /**
   * Every channel the user belongs to, including closed ones.
   */
  listAll: op<{ updatedAt?: number } | undefined, Channel[]>('channels.listAll', 'query'),

  /**
   * Email-type channels only (the support desk surface).
   */
  listEmail: op<void, ChannelUserStatus[]>('channels.listEmail', 'query'),

  /**
   * Public channels the user could join but has not.
   */
  listBrowsable: op<void, Channel[]>('channels.listBrowsable', 'query'),

  /**
   * Message and participant counts for one channel.
   */
  getStats: op<{ channelId: string }, unknown>('channels.getStats', 'query'),

  /**
   * The current user's read state for one channel.
   */
  getUserStatus: op<{ channelId: string }, ChannelUserStatus | null>('channels.getUserStatus', 'query'),

  /**
   * Participants of a channel.
   */
  listParticipants: op<{ channelId: string }, ChannelParticipant[]>('channels.listParticipants', 'query'),

  /**
   * Participants matching a search term.
   */
  searchParticipants: op<{ channelId: string; searchQuery: string }, ChannelParticipant[]>('channels.searchParticipants', 'query'),

  /**
   * The current user's participation across several channels at once.
   */
  getMyParticipations: op<{ channelIds: string[] }, ChannelParticipant[]>('channels.getMyParticipations', 'query'),

  /**
   * Links shared in a channel.
   */
  listLinks: op<{ channelId: string }, unknown[]>('channels.listLinks', 'query'),

  /**
   * The current user's sidebar sections.
   */
  listSections: op<void, ChannelSection[]>('channels.listSections', 'query'),

  // ----- Writes -----

  /**
   * Join a public channel.
   */
  join: op<{ channelId: string }, void>('channels.join', 'mutator'),

  /**
   * Leave a channel.
   */
  leave: op<{ channelId: string }, void>('channels.leave', 'mutator'),

  /**
   * Add users to a channel.
   *
   * The mutator wants a participant id and a user-status id per user, keyed by
   * user id; both maps are generated here.
   */
  addParticipants: op<{ channelId: string; userIds: string[] }, void>('channels.addParticipants', 'mutator'),

  /**
   * Remove a user from a channel.
   */
  removeParticipant: op<{ channelId: string; userId: string }, void>('channels.removeParticipant', 'mutator'),

  /**
   * Change a participant's role. Posts a system message into the channel, hence
   * the generated conversation/message ids.
   */
  updateParticipantRole: op<{ channelId: string; userId: string; role: ChannelRole }, void>('channels.updateParticipantRole', 'mutator'),

  /**
   * Rename a channel.
   */
  rename: op<{ channelId: string; name: string }, void>('channels.rename', 'mutator'),

  /**
   * Set a channel's description. Also posts a system message.
   */
  updateDescription: op<{ channelId: string; description: string }, void>('channels.updateDescription', 'mutator'),

  /**
   * Archive a channel.
   */
  archive: op<{ channelId: string }, void>('channels.archive', 'mutator'),

  /**
   * Restore an archived channel.
   */
  unarchive: op<{ channelId: string }, void>('channels.unarchive', 'mutator'),

  /**
   * Convert a private channel to public. Not reversible through this API.
   */
  makePublic: op<{ channelId: string }, void>('channels.makePublic', 'mutator'),

  /**
   * Star or unstar a channel. The mutator toggles; there is no explicit target
   * state.
   */
  toggleStarred: op<{ channelId: string }, void>('channels.toggleStarred', 'mutator'),

  /**
   * Mark a channel as read up to now, optionally preserving an unsent draft.
   */
  markAsViewed: op<{ channelId: string; conversationId?: string; draftMessage?: string }, void>('channels.markAsViewed', 'mutator'),

  /**
   * Move a channel into a sidebar section. Pass `sectionId: null` to ungroup.
   */
  moveToSection: op<{ channelId: string; sectionId: string | null; position: string }, void>('channels.moveToSection', 'mutator'),

  // ----- Sections -----

  /**
   * Create a sidebar section.
   *
   * Takes the new row's `id` rather than generating it here: mutators return
   * nothing, so the id has to be minted by the caller (the resource method) for
   * it to be returned to the user.
   */
  createSection: op<{ id: string; name: string; position: string; emoji?: string | null }, void>('channels.createSection', 'mutator'),

  /**
   * Update a sidebar section.
   */
  updateSection: op<{
      id: string;
      name?: string;
      emoji?: string | null;
      isCollapsed?: boolean;
      position?: string;
    }, void>('channels.updateSection', 'mutator'),

  /**
   * Delete a sidebar section.
   */
  removeSection: op<{ id: string }, void>('channels.removeSection', 'mutator'),
  /**
   * Close a DM, hiding it from the sidebar without losing history.
   */
  closeDm: op<{ channelId: string }, void>('channels.closeDm', 'mutator'),

  /**
   * Reopen a closed DM.
   */
  reopenDm: op<{ channelId: string }, void>('channels.reopenDm', 'mutator'),

  /**
   * Turn a group DM into a named channel. Posts a system message announcing it.
   */
  promoteToChannel: op<{
      channelId: string;
      name: string;
      projectId: string;
      visibility: 'PUBLIC' | 'PRIVATE';
      description?: string;
    }, void>('channels.promoteToChannel', 'mutator'),

  /**
   * Mark a channel unread starting at a given message.
   */
  markUnreadFrom: op<{ channelId: string; messageId: string; conversationId?: string }, void>('channels.markUnreadFrom', 'mutator'),

  /**
   * Set who may add people to the channel.
   */
  setAddUserPolicy: op<{ channelId: string; policy: string }, void>('channels.setAddUserPolicy', 'mutator'),

  /**
   * Set the prompt used to summarise calls held in this channel.
   */
  setCallSummaryPrompt: op<{ channelId: string; prompt: string }, void>('channels.setCallSummaryPrompt', 'mutator'),

  /**
   * Pin a board to the channel's tickets tab.
   */
  setSelectedBoard: op<{ channelId: string; boardId: string | null }, void>('channels.setSelectedBoard', 'mutator'),

  /**
   * Show or hide ticket activity inline in the channel.
   */
  setShowTicketsInChat: op<{ channelId: string; show: boolean }, void>('channels.setShowTicketsInChat', 'mutator'),
  /**
   * Stats for several channels at once.
   */
  getStatsForChannels: op<{ channelIds: string[] }, unknown[]>('channels.getStatsForChannels', 'query'),

  /**
   * Participants of a channel, a page at a time.
   */
  listParticipantsPaginated: op<{ channelId: string; limit?: number; start?: { role: string; userId: string } }, ChannelParticipant[]>('channels.listParticipantsPaginated', 'query'),

  /**
   * Every user's status row for one channel — who has it open, muted, starred.
   */
  listUserStatuses: op<{ channelId: string }, ChannelUserStatus[]>('channels.listUserStatuses', 'query'),

  /**
   * Channels the current user has an active conversation in.
   */
  listWithMyConversations: op<void, Channel[]>('channels.listWithMyConversations', 'query'),
} as const;
