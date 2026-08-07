/**
 * Channels Resource
 *
 * Channel membership, settings, participants, and sidebar sections.
 */

import { Resource } from './base.js';
import { channelsOperations } from '../registry/channels.js';
import { newId } from '../core/ids.js';
import type {
  Channel,
  ChannelParticipant,
  ChannelRole,
  ChannelSection,
  ChannelUserStatus,
} from '../types/index.js';

export class ChannelsResource extends Resource {
  /**
   * List the channels visible to the current user.
   *
   * Returns per-user channel status rows, each carrying its `channel` relation —
   * this is the shape the sidebar is built from, so it includes read state and
   * starring alongside the channel itself.
   *
   * @example
   * const channels = await sdk.channels.list();
   */
  list(): Promise<ChannelUserStatus[]> {
    return this.call(channelsOperations.list, undefined);
  }

  /**
   * List every channel the user belongs to, including closed ones.
   *
   * @param options.updatedAt - Only return channels changed after this epoch ms
   */
  listAll(options?: { updatedAt?: number }): Promise<Channel[]> {
    return this.call(channelsOperations.listAll, options);
  }

  /** List the user's email (support desk) channels. */
  listEmail(): Promise<ChannelUserStatus[]> {
    return this.call(channelsOperations.listEmail, undefined);
  }

  /** List public channels the user can join but has not joined. */
  listBrowsable(): Promise<Channel[]> {
    return this.call(channelsOperations.listBrowsable, undefined);
  }

  /** Get message and participant counts for a channel. */
  getStats(channelId: string): Promise<unknown> {
    return this.call(channelsOperations.getStats, { channelId });
  }

  /** Get the current user's read state for a channel. */
  getUserStatus(channelId: string): Promise<ChannelUserStatus | null> {
    return this.call(channelsOperations.getUserStatus, { channelId });
  }

  /** List a channel's participants. */
  listParticipants(channelId: string): Promise<ChannelParticipant[]> {
    return this.call(channelsOperations.listParticipants, { channelId });
  }

  /** Search a channel's participants by name or email. */
  searchParticipants(channelId: string, searchQuery: string): Promise<ChannelParticipant[]> {
    return this.call(channelsOperations.searchParticipants, { channelId, searchQuery });
  }

  /** Get the current user's participation across several channels at once. */
  getMyParticipations(channelIds: string[]): Promise<ChannelParticipant[]> {
    return this.call(channelsOperations.getMyParticipations, { channelIds });
  }

  /** List links shared in a channel. */
  listLinks(channelId: string): Promise<unknown[]> {
    return this.call(channelsOperations.listLinks, { channelId });
  }

  /**
   * Join a public channel.
   *
   * @example
   * await sdk.channels.join('channel-123');
   */
  join(channelId: string): Promise<void> {
    return this.call(channelsOperations.join, { channelId });
  }

  /** Leave a channel. */
  leave(channelId: string): Promise<void> {
    return this.call(channelsOperations.leave, { channelId });
  }

  /**
   * Add users to a channel.
   *
   * @example
   * await sdk.channels.addParticipants('channel-123', ['user-1', 'user-2']);
   */
  addParticipants(channelId: string, userIds: string[]): Promise<void> {
    return this.call(channelsOperations.addParticipants, { channelId, userIds });
  }

  /** Remove a user from a channel. */
  removeParticipant(channelId: string, userId: string): Promise<void> {
    return this.call(channelsOperations.removeParticipant, { channelId, userId });
  }

  /** Promote or demote a participant. Posts a system message into the channel. */
  updateParticipantRole(
    channelId: string,
    userId: string,
    role: ChannelRole
  ): Promise<void> {
    return this.call(channelsOperations.updateParticipantRole, { channelId, userId, role });
  }

  /** Rename a channel. Names must be 2–80 characters. */
  rename(channelId: string, name: string): Promise<void> {
    return this.call(channelsOperations.rename, { channelId, name });
  }

  /** Set a channel's description. Posts a system message into the channel. */
  updateDescription(channelId: string, description: string): Promise<void> {
    return this.call(channelsOperations.updateDescription, { channelId, description });
  }

  /** Archive a channel. */
  archive(channelId: string): Promise<void> {
    return this.call(channelsOperations.archive, { channelId });
  }

  /** Restore an archived channel. */
  unarchive(channelId: string): Promise<void> {
    return this.call(channelsOperations.unarchive, { channelId });
  }

  /**
   * Convert a private channel to public.
   *
   * There is no matching "make private" operation — this is one-way.
   */
  makePublic(channelId: string): Promise<void> {
    return this.call(channelsOperations.makePublic, { channelId });
  }

  /**
   * Toggle a channel's starred state.
   *
   * This flips the current value rather than setting it; read `isStarred` from
   * `getUserStatus` first if you need a specific end state.
   */
  toggleStarred(channelId: string): Promise<void> {
    return this.call(channelsOperations.toggleStarred, { channelId });
  }

  /**
   * Mark a channel read as of now.
   *
   * @param options.draftMessage - Preserve an unsent draft while marking read
   */
  markAsViewed(
    channelId: string,
    options?: { conversationId?: string; draftMessage?: string }
  ): Promise<void> {
    return this.call(channelsOperations.markAsViewed, { channelId, ...options });
  }

  /** Move a channel into a sidebar section, or pass `null` to ungroup it. */
  moveToSection(
    channelId: string,
    sectionId: string | null,
    position: string
  ): Promise<void> {
    return this.call(channelsOperations.moveToSection, { channelId, sectionId, position });
  }

  // ----- Sidebar sections -----

  /** List the current user's sidebar sections. */
  listSections(): Promise<ChannelSection[]> {
    return this.call(channelsOperations.listSections, undefined);
  }

  /**
   * Create a sidebar section.
   *
   * @returns The id of the new section
   *
   * @example
   * const { id } = await sdk.channels.createSection({ name: 'Projects', position: 'a0' });
   */
  async createSection(data: {
    name: string;
    position: string;
    emoji?: string | null;
  }): Promise<{ id: string }> {
    const id = newId();
    await this.call(channelsOperations.createSection, { id, ...data });
    return { id };
  }

  /** Update a sidebar section. */
  updateSection(
    id: string,
    data: {
      name?: string;
      emoji?: string | null;
      isCollapsed?: boolean;
      position?: string;
    }
  ): Promise<void> {
    return this.call(channelsOperations.updateSection, { id, ...data });
  }

  /** Delete a sidebar section. */
  removeSection(id: string): Promise<void> {
    return this.call(channelsOperations.removeSection, { id });
  }
  // ----- DMs and channel settings -----

  /** Close a DM, hiding it from the sidebar without losing its history. */
  closeDm(channelId: string): Promise<void> {
    return this.call(channelsOperations.closeDm, { channelId });
  }

  /** Reopen a closed DM. */
  reopenDm(channelId: string): Promise<void> {
    return this.call(channelsOperations.reopenDm, { channelId });
  }

  /**
   * Turn a group DM into a named channel.
   *
   * Posts a system message announcing the change.
   */
  promoteToChannel(data: {
    channelId: string;
    name: string;
    projectId: string;
    visibility: 'PUBLIC' | 'PRIVATE';
    description?: string;
  }): Promise<void> {
    return this.call(channelsOperations.promoteToChannel, data);
  }

  /** Mark a channel unread starting from a specific message. */
  markUnreadFrom(
    channelId: string,
    messageId: string,
    options?: { conversationId?: string }
  ): Promise<void> {
    return this.call(channelsOperations.markUnreadFrom, {
      channelId,
      messageId,
      ...options,
    });
  }

  /**
   * Set who may add people to the channel.
   *
   * @param policy - `EVERYONE` or `ADMINS_ONLY`
   */
  setAddUserPolicy(channelId: string, policy: string): Promise<void> {
    return this.call(channelsOperations.setAddUserPolicy, { channelId, policy });
  }

  /** Set the prompt used to summarise calls held in this channel. */
  setCallSummaryPrompt(channelId: string, prompt: string): Promise<void> {
    return this.call(channelsOperations.setCallSummaryPrompt, { channelId, prompt });
  }

  /** Pin a board to the channel's tickets tab, or pass `null` to unpin. */
  setSelectedBoard(channelId: string, boardId: string | null): Promise<void> {
    return this.call(channelsOperations.setSelectedBoard, { channelId, boardId });
  }

  /** Show or hide ticket activity inline in the channel. */
  setShowTicketsInChat(channelId: string, show: boolean): Promise<void> {
    return this.call(channelsOperations.setShowTicketsInChat, { channelId, show });
  }
}
