/**
 * Workspace Resource
 *
 * Shared workspace-level items: links, connected repositories, custom emoji,
 * reference data, and mail classification routing.
 */

import { Resource } from './base.js';
import { workspaceOperations } from '../registry/workspace.js';
import { newId, newIdMap } from '../core/ids.js';
import type { SdlcTrackStatus } from '../types/index.js';

export class WorkspaceResource extends Resource {
  // ----- Links -----

  /**
   * Share a link in a channel.
   *
   * @returns The link id
   */
  async createLink(data: {
    url: string;
    title: string;
    channelId: string;
    visibility: string;
    description?: string;
    favicon?: string;
  }): Promise<{ id: string }> {
    const id = newId();
    await this.call(workspaceOperations.createLink, { id, ...data });
    return { id };
  }

  /** Update a shared link. */
  updateLink(
    id: string,
    data: {
      title?: string;
      description?: string;
      favicon?: string;
      visibility?: string;
    }
  ): Promise<void> {
    return this.call(workspaceOperations.updateLink, { id, ...data });
  }

  /** Delete a shared link. */
  deleteLink(id: string): Promise<void> {
    return this.call(workspaceOperations.deleteLink, { id });
  }

  /**
   * Share a link with specific users.
   *
   * @returns The access-grant ids, keyed by user id
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

  /** Stop sharing a link with someone. */
  unshareLink(linkId: string, userId: string): Promise<void> {
    return this.call(workspaceOperations.unshareLink, { linkId, userId });
  }

  // ----- Repositories -----

  /** List connected repositories. */
  listRepos(): Promise<unknown[]> {
    return this.call(workspaceOperations.listRepos, undefined);
  }

  /**
   * Connect a repository.
   *
   * @param data.prefix - Ticket-key prefix used for branches from this repo
   * @returns The repository id
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

  /** Update a repository's details. */
  updateRepo(
    id: string,
    data: { name?: string; url?: string; baseBranch?: string[]; prefix?: string }
  ): Promise<void> {
    return this.call(workspaceOperations.updateRepo, { id, ...data });
  }

  /** Disconnect a repository. */
  deleteRepo(id: string): Promise<void> {
    return this.call(workspaceOperations.deleteRepo, { id });
  }

  /** Track another branch on a repository. */
  addRepoBranch(id: string, branchName: string): Promise<void> {
    return this.call(workspaceOperations.addRepoBranch, { id, branchName });
  }

  // ----- SDLC -----

  /** One SDLC channel by id, or null if that channel is not an SDLC hub. */
  getSdlcChannel(channelId: string): Promise<unknown | null> {
    return this.call(workspaceOperations.getSdlcChannel, { channelId });
  }

  /** Tracks on an SDLC channel, oldest first. */
  listSdlcTracks(channelId: string): Promise<unknown[]> {
    return this.call(workspaceOperations.listSdlcTracks, { channelId });
  }

  /**
   * Start a track on an SDLC repository.
   *
   * The track id and timestamp are generated for you. You must be a
   * participant of the repository's channel.
   */
  createSdlcTrack(data: {
    repoId: string;
    name: string;
    description?: string;
  }): Promise<void> {
    return this.call(workspaceOperations.createSdlcTrack, data);
  }

  /** Change a track's name, description, or status. Pass null to clear a description. */
  updateSdlcTrack(
    trackId: string,
    updates: { name?: string; description?: string | null; status?: SdlcTrackStatus }
  ): Promise<void> {
    return this.call(workspaceOperations.updateSdlcTrack, { trackId, ...updates });
  }

  // ----- Custom emoji -----

  /** List the workspace's custom emoji. */
  listEmojis(): Promise<unknown[]> {
    return this.call(workspaceOperations.listEmojis, undefined);
  }

  /** Get a custom emoji by id. */
  getEmoji(emojiId: string): Promise<unknown> {
    return this.call(workspaceOperations.getEmoji, { emojiId });
  }

  /** Get a custom emoji by name. */
  getEmojiByName(name: string): Promise<unknown> {
    return this.call(workspaceOperations.getEmojiByName, { name });
  }

  // ----- Reference data -----

  /**
   * List lookup values of a given type.
   *
   * These are the enumerations used across forms and incident records — bug
   * types, severities, impact types, and so on.
   */
  listLookupValues(type: string): Promise<unknown[]> {
    return this.call(workspaceOperations.listLookupValues, { type });
  }

  /** List the merchants known to the workspace. */
  listMerchants(): Promise<unknown[]> {
    return this.call(workspaceOperations.listMerchants, undefined);
  }

  /** List the ticket tags defined in a project. */
  listTicketTags(projectId: string): Promise<unknown[]> {
    return this.call(workspaceOperations.listTicketTags, { projectId });
  }

  // ----- Classification routing -----

  /** List the rules routing mail categories to teams in a channel. */
  listClassificationMappings(channelId: string): Promise<unknown[]> {
    return this.call(workspaceOperations.listClassificationMappings, { channelId });
  }

  /**
   * Route a mail category to a team.
   *
   * @returns The rule id
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

  /** Change a routing rule. */
  updateClassificationMapping(
    id: string,
    data: { category?: string; subCategory?: string; userGroupId?: string }
  ): Promise<void> {
    return this.call(workspaceOperations.updateClassificationMapping, { id, ...data });
  }

  /** Remove a routing rule. */
  deleteClassificationMapping(id: string): Promise<void> {
    return this.call(workspaceOperations.deleteClassificationMapping, { id });
  }
}
