/**
 * Channels Resource
 *
 * Channel membership, settings, participants, and sidebar sections.
 */

import { Resource } from './base.js';
import { channelsOperations } from '../registry/channels.js';
import { newId } from '../core/ids.js';
import { paginate, type Page, type PageOptions } from '../core/paginate.js';
import type {
  Channel,
  ChannelAddUserPolicy,
  ChannelParticipant,
  ChannelRole,
  ChannelSection,
  ChannelStats,
  ChannelUserStatus,
  CheckDuplicateChannelResponse,
  CreateChannelInput,
  Link,
} from '../types/index.js';

export class ChannelsResource extends Resource {
  /**
   * List the channels visible to the current user.
   *
   * Returns per-user channel status rows, each carrying its `channel` relation —
   * this is the shape the sidebar is built from, so it includes read state and
   * starring alongside the channel itself.
   *
   * @returns One status row per visible channel, each with its `channel` joined.
   * @example
   * const channels = await sdk.channels.list();
   */
  list(): Promise<ChannelUserStatus[]> {
    return this.call(channelsOperations.list, undefined);
  }

  /**
   * List every channel the caller belongs to, including closed ones.
   *
   * @param options.updatedAt - Only return channels changed after this epoch-ms timestamp.
   * @returns The channels themselves, without per-user read state.
   * @example
   * const channels = await sdk.channels.listAll();
   */
  listAll(options?: { updatedAt?: number }): Promise<Channel[]> {
    return this.call(channelsOperations.listAll, options);
  }

  /**
   * List the caller's email (support desk) channels.
   *
   * @returns Status rows for their desk channels.
   * @example
   * const desks = await sdk.channels.listEmail();
   */
  listEmail(): Promise<ChannelUserStatus[]> {
    return this.call(channelsOperations.listEmail, undefined);
  }

  /**
   * List public channels the user can join but has not joined, one page at a
   * time. This read has no server-side cursor — it returns every matching
   * channel in the workspace in one response — so the SDK fetches that and
   * windows it. Defaults to the first 100, which is also the cap.
   *
   * @param options.limit - Page size. Defaults to 100, which is also the maximum.
   * @param options.offset - Where the page starts.
   * @returns One page of joinable channels.
   * @example
   * const page = await sdk.channels.listBrowsable({ limit: 20 });
   */
  async listBrowsable(options?: PageOptions): Promise<Page<Channel>> {
    const all = await this.call(channelsOperations.listBrowsable, undefined);
    return paginate(all, options);
  }

  /**
   * Get participant count and last-activity time for a channel.
   *
   * @param channelId - Channel to read.
   * @returns Its counters, or `null` if the channel has none yet.
   * @example
   * const stats = await sdk.channels.getStats('channel-1');
   */
  getStats(channelId: string): Promise<ChannelStats | null> {
    return this.call(channelsOperations.getStats, { channelId });
  }

  /**
   * Get the caller's read state for a channel.
   *
   * @param channelId - Channel to read.
   * @returns Their status row, or `null` if they are not in the channel.
   * @example
   * const status = await sdk.channels.getUserStatus('channel-1');
   */
  getUserStatus(channelId: string): Promise<ChannelUserStatus | null> {
    return this.call(channelsOperations.getUserStatus, { channelId });
  }

  /**
   * List a channel's participants, unpaginated.
   *
   * Fine for a small channel; for one that may have many members prefer
   * {@link listParticipantsPaginated}, which has a real server-side cursor
   * rather than fetching everyone and slicing.
   *
   * @param channelId - Channel to read.
   * @returns Every participant.
   * @example
   * const people = await sdk.channels.listParticipants('channel-1');
   */
  listParticipants(channelId: string): Promise<ChannelParticipant[]> {
    return this.call(channelsOperations.listParticipants, { channelId });
  }

  /**
   * Search a channel's participants by name or email.
   *
   * @param channelId - Channel to search.
   * @param searchQuery - Text to match against names and email addresses.
   * @returns Matching participants.
   * @example
   * const people = await sdk.channels.searchParticipants('channel-1', 'prajwal');
   */
  searchParticipants(channelId: string, searchQuery: string): Promise<ChannelParticipant[]> {
    return this.call(channelsOperations.searchParticipants, { channelId, searchQuery });
  }

  /**
   * Get the caller's participation across several channels at once.
   *
   * @param channelIds - Channels to read.
   * @returns Their participant row in each channel they belong to.
   * @example
   * const mine = await sdk.channels.getMyParticipations(['channel-1', 'channel-2']);
   */
  getMyParticipations(channelIds: string[]): Promise<ChannelParticipant[]> {
    return this.call(channelsOperations.getMyParticipations, { channelIds });
  }

  /**
   * List the links shared in a channel.
   *
   * @param channelId - Channel to read.
   * @returns Its shared links.
   * @example
   * const links = await sdk.channels.listLinks('channel-1');
   */
  listLinks(channelId: string): Promise<Link[]> {
    return this.call(channelsOperations.listLinks, { channelId });
  }

  /**
   * Create a channel, along with its stats, creator membership and desk
   * configuration, in one server-side transaction.
   *
   * @param data - The channel to create.
   * @returns The new channel's id.
   * @example
   * const { id } = await sdk.channels.create({
   *   name: 'platform-oncall',
   *   projectId: 'proj-1',
   *   visibility: 'PRIVATE',
   * });
   */
  create(data: CreateChannelInput): Promise<{ id: string }> {
    return this.call(channelsOperations.create, data);
  }

  /**
   * Check whether a channel name is already taken in a project.
   *
   * @param name - Name to test.
   * @param projectId - Project to test it in.
   * @returns Whether the name is free, and the clashing channel if not.
   * @example
   * const check = await sdk.channels.checkDuplicate('platform', 'proj-1');
   */
  checkDuplicate(name: string, projectId: string): Promise<CheckDuplicateChannelResponse> {
    return this.call(channelsOperations.checkDuplicate, { name, projectId });
  }

  /**
   * Join a public channel.
   *
   * @param channelId - Channel to join.
   * @example
   * await sdk.channels.join('channel-123');
   */
  join(channelId: string): Promise<void> {
    return this.call(channelsOperations.join, { channelId });
  }

  /**
   * Leave a channel.
   *
   * @param channelId - Channel to leave.
   * @example
   * await sdk.channels.leave('channel-1');
   */
  leave(channelId: string): Promise<void> {
    return this.call(channelsOperations.leave, { channelId });
  }

  /**
   * Add users to a channel.
   *
   * @param channelId - Channel to add them to.
   * @param userIds - People to add.
   * @example
   * await sdk.channels.addParticipants('channel-123', ['user-1', 'user-2']);
   */
  addParticipants(channelId: string, userIds: string[]): Promise<void> {
    return this.call(channelsOperations.addParticipants, { channelId, userIds });
  }

  /**
   * Remove a user from a channel.
   *
   * @param channelId - Channel to remove them from.
   * @param userId - Person to remove.
   * @example
   * await sdk.channels.removeParticipant('channel-1', 'user-1');
   */
  removeParticipant(channelId: string, userId: string): Promise<void> {
    return this.call(channelsOperations.removeParticipant, { channelId, userId });
  }

  /**
   * Promote or demote a participant. Posts a system message into the channel.
   *
   * @param channelId - Channel the membership is in.
   * @param userId - Person whose role changes.
   * @param role - Their new role.
   * @example
   * await sdk.channels.updateParticipantRole('channel-1', 'user-1', 'ADMIN');
   */
  updateParticipantRole(
    channelId: string,
    userId: string,
    role: ChannelRole
  ): Promise<void> {
    return this.call(channelsOperations.updateParticipantRole, { channelId, userId, role });
  }

  /**
   * Rename a channel.
   *
   * @param channelId - Channel to rename.
   * @param name - New name, 2-80 characters.
   * @example
   * await sdk.channels.rename('channel-1', 'platform-oncall');
   */
  rename(channelId: string, name: string): Promise<void> {
    return this.call(channelsOperations.rename, { channelId, name });
  }

  /**
   * Set a channel's description. Posts a system message into the channel.
   *
   * @param channelId - Channel to change.
   * @param description - New description.
   * @example
   * await sdk.channels.updateDescription('channel-1', 'Platform on-call rotation');
   */
  updateDescription(channelId: string, description: string): Promise<void> {
    return this.call(channelsOperations.updateDescription, { channelId, description });
  }

  /**
   * Archive a channel, hiding it from the default listings.
   *
   * @param channelId - Channel to archive.
   * @example
   * await sdk.channels.archive('channel-1');
   */
  archive(channelId: string): Promise<void> {
    return this.call(channelsOperations.archive, { channelId });
  }

  /**
   * Restore an archived channel.
   *
   * @param channelId - Channel to restore.
   * @example
   * await sdk.channels.unarchive('channel-1');
   */
  unarchive(channelId: string): Promise<void> {
    return this.call(channelsOperations.unarchive, { channelId });
  }

  /**
   * Convert a private channel to public.
   *
   * There is no matching "make private" operation — this is one-way.
   *
   * @param channelId - Channel to open up.
   * @example
   * await sdk.channels.makePublic('channel-1');
   */
  makePublic(channelId: string): Promise<void> {
    return this.call(channelsOperations.makePublic, { channelId });
  }

  /**
   * Toggle a channel's starred state.
   *
   * This flips the current value rather than setting it; read `isStarred` from
   * {@link getUserStatus} first if you need a specific end state.
   *
   * @param channelId - Channel to star or unstar.
   * @example
   * await sdk.channels.toggleStarred('channel-1');
   */
  toggleStarred(channelId: string): Promise<void> {
    return this.call(channelsOperations.toggleStarred, { channelId });
  }

  /**
   * Mark a channel read as of now.
   *
   * @param channelId - Channel to mark.
   * @param options.conversationId - Mark only one thread within it.
   * @param options.draftMessage - Unsent draft to preserve while marking read.
   * @example
   * await sdk.channels.markAsViewed('channel-1');
   */
  markAsViewed(
    channelId: string,
    options?: { conversationId?: string; draftMessage?: string }
  ): Promise<void> {
    return this.call(channelsOperations.markAsViewed, { channelId, ...options });
  }

  /**
   * Move a channel into a sidebar section.
   *
   * @param channelId - Channel to move.
   * @param sectionId - Section to move it into, or `null` to ungroup it.
   * @example
   * await sdk.channels.moveToSection('channel-1', 'section-1');
   */
  moveToSection(
    channelId: string,
    sectionId: string | null,
    position: string
  ): Promise<void> {
    return this.call(channelsOperations.moveToSection, { channelId, sectionId, position });
  }

  // ----- Sidebar sections -----

  /**
   * List the caller's sidebar sections.
   *
   * @returns Their sections, in display order.
   * @example
   * const sections = await sdk.channels.listSections();
   */
  listSections(): Promise<ChannelSection[]> {
    return this.call(channelsOperations.listSections, undefined);
  }

  /**
   * Create a sidebar section.
   *
   * @param data.name - Display name.
   * @param data.position - Sort key deciding where it appears.
   * @param data.emoji - Icon shown beside the name.
   * @returns The new section's id.
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

  /**
   * Update a sidebar section.
   *
   * @param id - Id of the section.
   * @param data - Fields to change; omitted fields are left alone.
   * @example
   * await sdk.channels.updateSection('section-1', { name: 'Projects' });
   */
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

  /**
   * Delete a sidebar section. Its channels become ungrouped.
   *
   * @param id - Id of the section.
   * @example
   * await sdk.channels.removeSection('section-1');
   */
  removeSection(id: string): Promise<void> {
    return this.call(channelsOperations.removeSection, { id });
  }
  // ----- DMs and channel settings -----

  /**
   * Close a DM, hiding it from the sidebar without losing its history.
   *
   * @param channelId - DM to close.
   * @example
   * await sdk.channels.closeDm('channel-dm-1');
   */
  closeDm(channelId: string): Promise<void> {
    return this.call(channelsOperations.closeDm, { channelId });
  }

  /**
   * Reopen a closed DM.
   *
   * @param channelId - DM to reopen.
   * @example
   * await sdk.channels.reopenDm('channel-dm-1');
   */
  reopenDm(channelId: string): Promise<void> {
    return this.call(channelsOperations.reopenDm, { channelId });
  }

  /**
   * Turn a group DM into a named channel.
   *
   * Posts a system message announcing the change.
   *
   * @param data.channelId - The group DM to convert.
   * @param data.name - Name for the new channel.
   * @param data.projectId - Project it belongs to.
   * @param data.visibility - Whether it is public or private.
   * @param data.description - Channel description.
   * @example
   * await sdk.channels.promoteToChannel({
   *   channelId: 'channel-dm-1',
   *   name: 'payments-incident',
   *   projectId: 'proj-1',
   *   visibility: 'PRIVATE',
   * });
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

  /**
   * Mark a channel unread from one message onwards.
   *
   * @param channelId - Channel to mark.
   * @param messageId - First message to treat as unread.
   * @param options.conversationId - Mark only within one thread.
   * @example
   * await sdk.channels.markUnreadFrom('channel-1', 'message-5');
   */
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
   * @param channelId - Channel to configure.
   * @param policy - Whether everyone or only admins may add people.
   * @example
   * await sdk.channels.setAddUserPolicy('channel-1', 'ADMINS_ONLY');
   */
  setAddUserPolicy(channelId: string, policy: ChannelAddUserPolicy): Promise<void> {
    return this.call(channelsOperations.setAddUserPolicy, { channelId, policy });
  }

  /**
   * Set the prompt used to summarise calls held in this channel.
   *
   * @param channelId - Channel to configure.
   * @param prompt - Instruction applied when a call is summarised.
   * @example
   * await sdk.channels.setCallSummaryPrompt('channel-1', 'Focus on decisions and owners.');
   */
  setCallSummaryPrompt(channelId: string, prompt: string): Promise<void> {
    return this.call(channelsOperations.setCallSummaryPrompt, { channelId, prompt });
  }

  /**
   * Pin a board to the channel's tickets tab.
   *
   * @param channelId - Channel to configure.
   * @param boardId - Board to pin, or `null` to unpin.
   * @example
   * await sdk.channels.setSelectedBoard('channel-1', 'board-1');
   */
  setSelectedBoard(channelId: string, boardId: string | null): Promise<void> {
    return this.call(channelsOperations.setSelectedBoard, { channelId, boardId });
  }

  /**
   * Show or hide ticket activity inline in the channel.
   *
   * @param channelId - Channel to configure.
   * @param show - Whether ticket activity appears in chat.
   * @example
   * await sdk.channels.setShowTicketsInChat('channel-1', true);
   */
  setShowTicketsInChat(channelId: string, show: boolean): Promise<void> {
    return this.call(channelsOperations.setShowTicketsInChat, { channelId, show });
  }

  /**
   * Get counters for several channels at once.
   *
   * @param channelIds - Channels to read.
   * @returns One counter row per channel that has one.
   * @example
   * const stats = await sdk.channels.getStatsForChannels(['channel-1', 'channel-2']);
   */
  getStatsForChannels(channelIds: string[]): Promise<ChannelStats[]> {
    return this.call(channelsOperations.getStatsForChannels, { channelIds });
  }

  /**
   * List a channel's participants a page at a time.
   *
   * Prefer this over {@link listParticipants} for large channels: it has a real
   * server-side cursor.
   *
   * @param channelId - Channel to read.
   * @param options.limit - Page size.
   * @param options.start - Cursor from the previous page.
   * @returns One page of participants.
   * @example
   * const page = await sdk.channels.listParticipantsPaginated('channel-1', { limit: 50 });
   */
  listParticipantsPaginated(
    channelId: string,
    options?: { limit?: number; start?: { role: string; userId: string } }
  ): Promise<ChannelParticipant[]> {
    return this.call(channelsOperations.listParticipantsPaginated, {
      channelId,
      ...options,
    });
  }

  /**
   * List every user's status row for a channel — who has it open, starred, muted.
   *
   * @param channelId - Channel to read.
   * @returns One status row per member.
   * @example
   * const statuses = await sdk.channels.listUserStatuses('channel-1');
   */
  listUserStatuses(channelId: string): Promise<ChannelUserStatus[]> {
    return this.call(channelsOperations.listUserStatuses, { channelId });
  }

  /**
   * List channels the caller has an active thread in.
   *
   * @returns Those channels.
   * @example
   * const channels = await sdk.channels.listWithMyConversations();
   */
  listWithMyConversations(): Promise<Channel[]> {
    return this.call(channelsOperations.listWithMyConversations, undefined);
  }
}
