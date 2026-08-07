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

import { query, mutator } from './types.js';
import { newId, newIdMap, now } from '../core/ids.js';
import type {
  Channel,
  ChannelParticipant,
  ChannelRole,
  ChannelSection,
  ChannelUserStatus,
} from '../types/index.js';

export const channelsOperations = {
  // ----- Reads -----

  /**
   * Channels visible to the current user, with channel and stats relations.
   * Maps to: Zero query 'userVisibleChannelsV3'
   */
  list: query<void, ChannelUserStatus[]>('userVisibleChannelsV3'),

  /**
   * Every channel the user belongs to, including closed ones.
   * Maps to: Zero query 'userAllChannels'
   */
  listAll: query<{ updatedAt?: number } | undefined, Channel[]>('userAllChannels', {
    mapArgs: (args) => ({ updatedAt: args?.updatedAt }),
  }),

  /**
   * Email-type channels only (the support desk surface).
   * Maps to: Zero query 'userVisibleEmailChannels'
   */
  listEmail: query<void, ChannelUserStatus[]>('userVisibleEmailChannels'),

  /**
   * Public channels the user could join but has not.
   * Maps to: Zero query 'browsableChannels'
   */
  listBrowsable: query<void, Channel[]>('browsableChannels'),

  /**
   * Message and participant counts for one channel.
   * Maps to: Zero query 'channelStats'
   */
  getStats: query<{ channelId: string }, unknown>('channelStats'),

  /**
   * The current user's read state for one channel.
   * Maps to: Zero query 'getChannelUserStatus'
   */
  getUserStatus: query<{ channelId: string }, ChannelUserStatus | null>('getChannelUserStatus'),

  /**
   * Participants of a channel.
   * Maps to: Zero query 'channelParticipants'
   */
  listParticipants: query<{ channelId: string }, ChannelParticipant[]>('channelParticipants'),

  /**
   * Participants matching a search term.
   * Maps to: Zero query 'searchChannelParticipants'
   */
  searchParticipants: query<
    { channelId: string; searchQuery: string },
    ChannelParticipant[]
  >('searchChannelParticipants'),

  /**
   * The current user's participation across several channels at once.
   * Maps to: Zero query 'getUserMultipleChannelParticipations'
   */
  getMyParticipations: query<{ channelIds: string[] }, ChannelParticipant[]>(
    'getUserMultipleChannelParticipations'
  ),

  /**
   * Links shared in a channel.
   * Maps to: Zero query 'channelLinks'
   */
  listLinks: query<{ channelId: string }, unknown[]>('channelLinks'),

  /**
   * The current user's sidebar sections.
   * Maps to: Zero query 'userChannelSections'
   */
  listSections: query<void, ChannelSection[]>('userChannelSections'),

  // ----- Writes -----

  /**
   * Join a public channel.
   * Maps to: Zero mutator 'channel.joinChannel'
   */
  join: mutator<{ channelId: string }, void>('channel.joinChannel', {
    mapArgs: (args) => ({
      channelId: args.channelId,
      channelParticipantId: newId(),
      channelUserStatusId: newId(),
      timestamp: now(),
    }),
  }),

  /**
   * Leave a channel.
   * Maps to: Zero mutator 'channel.leaveChannel'
   */
  leave: mutator<{ channelId: string }, void>('channel.leaveChannel', {
    mapArgs: (args) => ({ channelId: args.channelId, updatedAt: now() }),
  }),

  /**
   * Add users to a channel.
   *
   * The mutator wants a participant id and a user-status id per user, keyed by
   * user id; both maps are generated here.
   * Maps to: Zero mutator 'channel.addParticipants'
   */
  addParticipants: mutator<{ channelId: string; userIds: string[] }, void>(
    'channel.addParticipants',
    {
      mapArgs: (args) => ({
        channelId: args.channelId,
        userIds: args.userIds,
        timestamp: now(),
        participantIds: newIdMap(args.userIds),
        userStatusIds: newIdMap(args.userIds),
      }),
    }
  ),

  /**
   * Remove a user from a channel.
   * Maps to: Zero mutator 'channel.removeParticipant'
   */
  removeParticipant: mutator<{ channelId: string; userId: string }, void>(
    'channel.removeParticipant',
    {
      mapArgs: (args) => ({
        channelId: args.channelId,
        targetUserId: args.userId,
        updatedAt: now(),
      }),
    }
  ),

  /**
   * Change a participant's role. Posts a system message into the channel, hence
   * the generated conversation/message ids.
   * Maps to: Zero mutator 'channel.updateParticipantRole'
   */
  updateParticipantRole: mutator<
    { channelId: string; userId: string; role: ChannelRole },
    void
  >('channel.updateParticipantRole', {
    mapArgs: (args) => ({
      channelId: args.channelId,
      targetUserId: args.userId,
      newRole: args.role,
      timestamp: now(),
      conversationId: newId(),
      messageId: newId(),
      conversationParticipantId: newId(),
    }),
  }),

  /**
   * Rename a channel.
   * Maps to: Zero mutator 'channel.renameChannel'
   */
  rename: mutator<{ channelId: string; name: string }, void>('channel.renameChannel', {
    mapArgs: (args) => ({
      channelId: args.channelId,
      name: args.name,
      timestamp: now(),
    }),
  }),

  /**
   * Set a channel's description. Also posts a system message.
   * Maps to: Zero mutator 'channel.updateDescription'
   */
  updateDescription: mutator<{ channelId: string; description: string }, void>(
    'channel.updateDescription',
    {
      mapArgs: (args) => ({
        channelId: args.channelId,
        description: args.description,
        timestamp: now(),
        conversationId: newId(),
        messageId: newId(),
        conversationParticipantId: newId(),
      }),
    }
  ),

  /**
   * Archive a channel.
   * Maps to: Zero mutator 'channel.archiveChannel'
   */
  archive: mutator<{ channelId: string }, void>('channel.archiveChannel'),

  /**
   * Restore an archived channel.
   * Maps to: Zero mutator 'channel.unarchiveChannel'
   */
  unarchive: mutator<{ channelId: string }, void>('channel.unarchiveChannel'),

  /**
   * Convert a private channel to public. Not reversible through this API.
   * Maps to: Zero mutator 'channel.makeChannelPublic'
   */
  makePublic: mutator<{ channelId: string }, void>('channel.makeChannelPublic'),

  /**
   * Star or unstar a channel. The mutator toggles; there is no explicit target
   * state.
   * Maps to: Zero mutator 'channel.toggleStarred'
   */
  toggleStarred: mutator<{ channelId: string }, void>('channel.toggleStarred', {
    mapArgs: (args) => ({ channelId: args.channelId, updatedAt: now() }),
  }),

  /**
   * Mark a channel as read up to now, optionally preserving an unsent draft.
   * Maps to: Zero mutator 'channel.markChannelAsViewed'
   */
  markAsViewed: mutator<
    { channelId: string; conversationId?: string; draftMessage?: string },
    void
  >('channel.markChannelAsViewed', {
    mapArgs: (args) => ({
      channelId: args.channelId,
      ...(args.conversationId ? { conversationId: args.conversationId } : {}),
      timestamp: now(),
      draftMessage: args.draftMessage ?? '',
      draftMessageId: newId(),
    }),
  }),

  /**
   * Move a channel into a sidebar section. Pass `sectionId: null` to ungroup.
   * Maps to: Zero mutator 'channel.moveToSection'
   */
  moveToSection: mutator<
    { channelId: string; sectionId: string | null; position: string },
    void
  >('channel.moveToSection', {
    mapArgs: (args) => ({
      channelId: args.channelId,
      sectionId: args.sectionId,
      position: args.position,
      timestamp: now(),
    }),
  }),

  // ----- Sections -----

  /**
   * Create a sidebar section.
   *
   * Takes the new row's `id` rather than generating it here: mutators return
   * nothing, so the id has to be minted by the caller (the resource method) for
   * it to be returned to the user.
   * Maps to: Zero mutator 'channelSection.create'
   */
  createSection: mutator<
    { id: string; name: string; position: string; emoji?: string | null },
    void
  >('channelSection.create', {
    mapArgs: (args) => ({
      id: args.id,
      name: args.name,
      position: args.position,
      emoji: args.emoji ?? null,
      timestamp: now(),
    }),
  }),

  /**
   * Update a sidebar section.
   * Maps to: Zero mutator 'channelSection.update'
   */
  updateSection: mutator<
    {
      id: string;
      name?: string;
      emoji?: string | null;
      isCollapsed?: boolean;
      position?: string;
    },
    void
  >('channelSection.update', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),

  /**
   * Delete a sidebar section.
   * Maps to: Zero mutator 'channelSection.remove'
   */
  removeSection: mutator<{ id: string }, void>('channelSection.remove', {
    mapArgs: (args) => ({ id: args.id, timestamp: now() }),
  }),
} as const;
