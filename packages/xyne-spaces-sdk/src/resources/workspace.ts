/**
 * Workspace Resource
 *
 * Shared workspace-level items: links, connected repositories, custom emoji,
 * reference data, and mail classification routing.
 */

import { Resource } from './base.js';
import { workspaceOperations } from '../registry/workspace.js';
import { newId, newIdMap } from '../core/ids.js';
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

export class WorkspaceResource extends Resource {
  // ----- Links -----

  /**
   * Share a link in a channel.
   *
   * @param data - The link to share.
   * @param data.url - Address being shared.
   * @param data.title - Display title.
   * @param data.channelId - Channel to share it in.
   * @param data.visibility - Who can see it.
   * @param data.description - Short description.
   * @param data.favicon - Icon URL for the link.
   * @returns The new link's id.
   * @example
   * const { id } = await sdk.workspace.createLink({
   *   url: 'https://example.com/runbook',
   *   title: 'Checkout runbook',
   *   channelId: 'channel-1',
   *   visibility: 'PUBLIC',
   * });
   */
  async createLink(data: {
    url: string;
    title: string;
    channelId: string;
    visibility: LinkVisibility;
    description?: string;
    favicon?: string;
  }): Promise<{ id: string }> {
    const id = newId();
    await this.call(workspaceOperations.createLink, { id, ...data });
    return { id };
  }

  /**
   * Update a shared link.
   *
   * @param id - Id of the link.
   * @param data - Fields to change; omitted fields are left alone.
   * @example
   * await sdk.workspace.updateLink('link-1', { title: 'Checkout runbook v2' });
   */
  updateLink(
    id: string,
    data: {
      title?: string;
      description?: string;
      favicon?: string;
      visibility?: LinkVisibility;
    }
  ): Promise<void> {
    return this.call(workspaceOperations.updateLink, { id, ...data });
  }

  /**
   * Delete a shared link.
   *
   * @param id - Id of the link.
   * @example
   * await sdk.workspace.deleteLink('link-1');
   */
  deleteLink(id: string): Promise<void> {
    return this.call(workspaceOperations.deleteLink, { id });
  }

  /**
   * Share a link with specific users.
   *
   * @param linkId - Link to share.
   * @param userIds - Users to share it with.
   * @returns The access-grant ids, keyed by user id.
   * @example
   * const { accessIds } = await sdk.workspace.shareLink('link-1', ['user-1']);
   */
  async shareLink(
    linkId: string,
    userIds: string[]
  ): Promise<{ accessIds: Record<string, string> }> {
    const accessIdMap = newIdMap(userIds);
    await this.call(workspaceOperations.shareLink, {
      linkId,
      userIds,
      // The mutator takes a positional array; keep the map for the caller.
      accessIds: userIds.map((u) => accessIdMap[u] as string),
    });
    return { accessIds: accessIdMap };
  }

  /**
   * Stop sharing a link with one person.
   *
   * @param linkId - Link to unshare.
   * @param userId - User to remove access from.
   * @example
   * await sdk.workspace.unshareLink('link-1', 'user-1');
   */
  unshareLink(linkId: string, userId: string): Promise<void> {
    return this.call(workspaceOperations.unshareLink, { linkId, userId });
  }

  // ----- Repositories -----

  /**
   * List the repositories connected to the workspace.
   *
   * @returns Connected repositories with their base branches and prefixes.
   * @example
   * const repos = await sdk.workspace.listRepos();
   */
  listRepos(): Promise<Repo[]> {
    return this.call(workspaceOperations.listRepos, undefined);
  }

  /**
   * Connect a repository.
   *
   * @param data - The repository to connect.
   * @param data.name - Display name, e.g. `xyne-spaces`.
   * @param data.url - SSH or HTTPS clone URL.
   * @param data.baseBranch - Branches new work is cut from.
   * @param data.prefix - Prefix given to branches created here, e.g. `feature`.
   * @returns The new repository's id.
   * @example
   * const { id } = await sdk.workspace.createRepo({
   *   name: 'xyne-spaces',
   *   url: 'git@github.com:juspay/xyne-spaces.git',
   *   baseBranch: ['main'],
   *   prefix: 'feature',
   * });
   */
  async createRepo(data: {
    name: string;
    url: string;
    baseBranch: string[];
    prefix: string;
  }): Promise<{ id: string }> {
    const id = newId();
    await this.call(workspaceOperations.createRepo, { id, ...data });
    return { id };
  }

  /**
   * Update a repository's details.
   *
   * @param id - Id of the repository.
   * @param data - Fields to change; omitted fields are left alone.
   * @example
   * await sdk.workspace.updateRepo('repo-1', { prefix: 'feat' });
   */
  updateRepo(
    id: string,
    data: { name?: string; url?: string; baseBranch?: string[]; prefix?: string }
  ): Promise<void> {
    return this.call(workspaceOperations.updateRepo, { id, ...data });
  }

  /**
   * Disconnect a repository from the workspace.
   *
   * @param id - Id of the repository.
   * @example
   * await sdk.workspace.deleteRepo('repo-1');
   */
  deleteRepo(id: string): Promise<void> {
    return this.call(workspaceOperations.deleteRepo, { id });
  }

  /**
   * Add another base branch to a repository.
   *
   * @param id - Id of the repository.
   * @param branchName - Branch to start cutting work from.
   * @example
   * await sdk.workspace.addRepoBranch('repo-1', 'develop');
   */
  addRepoBranch(id: string, branchName: string): Promise<void> {
    return this.call(workspaceOperations.addRepoBranch, { id, branchName });
  }

  // ----- SDLC -----

  /**
   * Get one SDLC hub channel by id.
   *
   * @param channelId - Id of the channel.
   * @returns The channel with its participants and stats, or `null` if it is
   * not an SDLC hub.
   * @example
   * const hub = await sdk.workspace.getSdlcChannel('channel-1');
   */
  getSdlcChannel(channelId: string): Promise<Channel | null> {
    return this.call(workspaceOperations.getSdlcChannel, { channelId });
  }

  /**
   * List the tracks on an SDLC hub channel, oldest first.
   *
   * @param channelId - Id of the hub channel.
   * @returns Its tracks.
   * @example
   * const tracks = await sdk.workspace.listSdlcTracks('channel-1');
   */
  listSdlcTracks(channelId: string): Promise<SdlcTrack[]> {
    return this.call(workspaceOperations.listSdlcTracks, { channelId });
  }

  /**
   * Start a track on an SDLC repository.
   *
   * The track id and timestamp are generated for you. The caller must be a
   * participant of the repository's channel.
   *
   * @param data - The track to start.
   * @param data.repoId - Repository the track belongs to.
   * @param data.name - Display name.
   * @param data.description - What the track covers.
   * @example
   * await sdk.workspace.createSdlcTrack({ repoId: 'repo-1', name: 'Payments v2' });
   */
  createSdlcTrack(data: {
    repoId: string;
    name: string;
    description?: string;
  }): Promise<void> {
    return this.call(workspaceOperations.createSdlcTrack, data);
  }

  /**
   * Change a track's name, description or status.
   *
   * @param trackId - Id of the track.
   * @param data - Fields to change; omitted fields are left alone.
   * @param data.name - New display name.
   * @param data.description - New description. Pass `null` to clear it.
   * @param data.status - New status.
   * @example
   * await sdk.workspace.updateSdlcTrack('track-1', { status: 'COMPLETED' });
   */
  updateSdlcTrack(
    trackId: string,
    updates: { name?: string; description?: string | null; status?: SdlcTrackStatus }
  ): Promise<void> {
    return this.call(workspaceOperations.updateSdlcTrack, { trackId, ...updates });
  }

  // ----- Custom emoji -----

  /**
   * List the workspace's custom emoji.
   *
   * @returns Every uploaded emoji, with its image URL.
   * @example
   * const emojis = await sdk.workspace.listEmojis();
   */
  listEmojis(): Promise<CustomEmoji[]> {
    return this.call(workspaceOperations.listEmojis, undefined);
  }

  /**
   * Get one custom emoji by id.
   *
   * @param emojiId - Id of the emoji.
   * @returns The emoji, or `null` if it does not exist.
   * @example
   * const emoji = await sdk.workspace.getEmoji('emoji-1');
   */
  getEmoji(emojiId: string): Promise<CustomEmoji | null> {
    return this.call(workspaceOperations.getEmoji, { emojiId });
  }

  /**
   * Get one custom emoji by its short name.
   *
   * @param name - Short name, without surrounding colons.
   * @returns The emoji, or `null` if no emoji has that name.
   * @example
   * const emoji = await sdk.workspace.getEmojiByName('shipit');
   */
  getEmojiByName(name: string): Promise<CustomEmoji | null> {
    return this.call(workspaceOperations.getEmojiByName, { name });
  }

  // ----- Reference data -----

  /**
   * List lookup values of a given type.
   *
   * These are the configurable vocabularies used across forms and incident
   * records — bug types, impact types, corrective-action types, and so on.
   *
   * @param type - Which vocabulary to read.
   * @returns Its options.
   * @example
   * const bugTypes = await sdk.workspace.listLookupValues('BUG_TYPE');
   */
  listLookupValues(type: LookupType): Promise<LookupValue[]> {
    return this.call(workspaceOperations.listLookupValues, { type });
  }

  /**
   * List the merchants known to the workspace.
   *
   * @returns Merchants, each with the `mid` used across tickets and filters.
   * @example
   * const merchants = await sdk.workspace.listMerchants();
   */
  listMerchants(): Promise<Merchant[]> {
    return this.call(workspaceOperations.listMerchants, undefined);
  }

  /**
   * List the ticket tags used in a project.
   *
   * @param projectId - Project to read.
   * @returns Tags applied to that project's tickets.
   * @example
   * const tags = await sdk.workspace.listTicketTags('proj-1');
   */
  listTicketTags(projectId: string): Promise<TicketTag[]> {
    return this.call(workspaceOperations.listTicketTags, { projectId });
  }

  // ----- Classification routing -----

  /**
   * List the rules routing mail categories to teams in a channel.
   *
   * @param channelId - Desk channel to read.
   * @returns Its routing rules.
   * @example
   * const rules = await sdk.workspace.listClassificationMappings('channel-desk');
   */
  listClassificationMappings(channelId: string): Promise<ClassificationMapping[]> {
    return this.call(workspaceOperations.listClassificationMappings, { channelId });
  }

  /**
   * Route a mail category to a team.
   *
   * @param data - The rule to create.
   * @param data.channelId - Desk channel the rule applies in.
   * @param data.category - Category to match.
   * @param data.userGroupId - Group matching mail is routed to.
   * @param data.subCategory - Narrower match within the category.
   * @returns The new rule's id.
   * @example
   * const { id } = await sdk.workspace.createClassificationMapping({
   *   channelId: 'channel-desk',
   *   category: 'Refunds',
   *   userGroupId: 'group-1',
   * });
   */
  async createClassificationMapping(data: {
    channelId: string;
    category: string;
    userGroupId: string;
    subCategory?: string;
  }): Promise<{ id: string }> {
    const id = newId();
    await this.call(workspaceOperations.createClassificationMapping, { id, ...data });
    return { id };
  }

  /**
   * Change a routing rule.
   *
   * @param id - Id of the rule.
   * @param data - Fields to change; omitted fields are left alone.
   * @example
   * await sdk.workspace.updateClassificationMapping('rule-1', { category: 'Chargebacks' });
   */
  updateClassificationMapping(
    id: string,
    data: { category?: string; subCategory?: string; userGroupId?: string }
  ): Promise<void> {
    return this.call(workspaceOperations.updateClassificationMapping, { id, ...data });
  }

  /**
   * Remove a routing rule.
   *
   * @param id - Id of the rule.
   * @example
   * await sdk.workspace.deleteClassificationMapping('rule-1');
   */
  deleteClassificationMapping(id: string): Promise<void> {
    return this.call(workspaceOperations.deleteClassificationMapping, { id });
  }
}
