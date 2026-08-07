/**
 * Canvases Resource
 *
 * Collaborative documents: content, folders, sharing, inline comments, and
 * version history.
 */

import { Resource } from './base.js';
import {
  canvasesOperations,
  type CanvasCursor,
  type CanvasScope,
} from '../registry/canvases.js';
import { newId } from '../core/ids.js';
import type {
  Canvas,
  CanvasComment,
  CanvasCommentThread,
  CanvasCommentThreadStatus,
  CanvasFolder,
  CanvasParticipant,
  CanvasRole,
  CanvasVersion,
  CanvasVisibility,
} from '../types/index.js';

export class CanvasesResource extends Resource {
  /**
   * List the current user's canvases, newest first.
   *
   * @example
   * const canvases = await sdk.canvases.list({ limit: 20 });
   */
  list(options?: {
    limit?: number;
    start?: CanvasCursor;
    includeQuartoDocs?: boolean;
    direction?: 'forward' | 'backward';
  }): Promise<Canvas[]> {
    return this.call(canvasesOperations.list, options ?? {});
  }

  /** List the current user's Quarto documents. */
  listQuartoDocs(options?: {
    limit?: number;
    start?: CanvasCursor;
    direction?: 'forward' | 'backward';
  }): Promise<Canvas[]> {
    return this.call(canvasesOperations.listQuartoDocs, options ?? {});
  }

  /** List canvases in a channel. */
  listByChannel(
    channelId: string,
    options?: { limit?: number; start?: CanvasCursor; includeQuartoDocs?: boolean }
  ): Promise<Canvas[]> {
    return this.call(canvasesOperations.listByChannel, { channelId, ...options });
  }

  /** List Quarto documents in a channel. */
  listQuartoDocsByChannel(
    channelId: string,
    options?: { limit?: number; start?: CanvasCursor }
  ): Promise<Canvas[]> {
    return this.call(canvasesOperations.listQuartoDocsByChannel, { channelId, ...options });
  }

  /** List canvases in a project folder. */
  listByFolder(
    folderId: string,
    projectId: string,
    options?: { includeQuartoDocs?: boolean }
  ): Promise<Canvas[]> {
    return this.call(canvasesOperations.listByFolder, { folderId, projectId, ...options });
  }

  /**
   * List canvases at one level of the folder tree.
   *
   * The scope decides which id is required — `folder` needs `folderId`,
   * `channel` and `channel_root` need `channelId`, `personal_root` needs
   * neither. Passing the wrong combination is rejected by the server.
   *
   * @example
   * const rootDocs = await sdk.canvases.listHierarchy({ scope: 'personal_root' });
   */
  listHierarchy(options: {
    scope?: CanvasScope;
    channelId?: string;
    folderId?: string;
    projectId?: string;
    includeQuartoDocs?: boolean;
  }): Promise<Canvas[]> {
    return this.call(canvasesOperations.listHierarchy, options);
  }

  /** Get one canvas. */
  get(canvasId: string): Promise<Canvas | null> {
    return this.call(canvasesOperations.get, { canvasId });
  }

  /** List the users, groups, and channels with access to a canvas. */
  listParticipants(canvasId: string): Promise<CanvasParticipant[]> {
    return this.call(canvasesOperations.listParticipants, { canvasId });
  }

  /** List a canvas's saved versions. */
  listVersions(canvasId: string): Promise<CanvasVersion[]> {
    return this.call(canvasesOperations.listVersions, { canvasId });
  }

  /**
   * Create a canvas.
   *
   * `content` is a BlockNote block array, not markdown. The creator becomes the
   * first participant, and share-link tokens are minted immediately.
   *
   * @returns The id of the new canvas
   *
   * @example
   * const { id } = await sdk.canvases.create({ title: 'Design notes' });
   */
  async create(data: {
    title: string;
    content?: unknown;
    channelId?: string;
    folderId?: string;
    projectId?: string;
    visibility?: CanvasVisibility;
  }): Promise<{ id: string }> {
    const id = newId();
    await this.call(canvasesOperations.create, { id, ...data });
    return { id };
  }

  /**
   * Update a canvas.
   *
   * When the canvas has `isCollaborative` set, the realtime server owns its
   * content — writing `content` here is not a safe read-modify-write against
   * concurrent editors. Save a version first if you need a restore point.
   */
  update(
    id: string,
    data: {
      title?: string;
      content?: unknown;
      visibility?: CanvasVisibility;
      isCollaborative?: boolean;
      folderId?: string;
      projectId?: string;
      channelId?: string;
    }
  ): Promise<void> {
    return this.call(canvasesOperations.update, { id, ...data });
  }

  /** Delete a canvas. */
  delete(id: string): Promise<void> {
    return this.call(canvasesOperations.delete, { id });
  }

  /** Toggle a canvas's starred state for the current user. */
  toggleStarred(id: string, canvasId: string): Promise<void> {
    return this.call(canvasesOperations.toggleStarred, { id, canvasId });
  }

  // ----- Sharing -----

  /** Grant users access to a canvas. */
  addParticipants(canvasId: string, userIds: string[], role: CanvasRole): Promise<void> {
    return this.call(canvasesOperations.addParticipants, { canvasId, userIds, role });
  }

  /** Grant a user group access. */
  addGroupParticipant(
    canvasId: string,
    userGroupId: string,
    role: CanvasRole
  ): Promise<void> {
    return this.call(canvasesOperations.addGroupParticipant, {
      canvasId,
      userGroupId,
      role,
    });
  }

  /** Grant a whole channel access. */
  addChannelParticipant(
    canvasId: string,
    channelId: string,
    role: CanvasRole
  ): Promise<void> {
    return this.call(canvasesOperations.addChannelParticipant, {
      canvasId,
      channelId,
      role,
    });
  }

  /** Revoke a user's access. */
  removeParticipant(canvasId: string, userId: string): Promise<void> {
    return this.call(canvasesOperations.removeParticipant, { canvasId, userId });
  }

  /** Revoke a group's access. */
  removeGroupParticipant(canvasId: string, userGroupId: string): Promise<void> {
    return this.call(canvasesOperations.removeGroupParticipant, { canvasId, userGroupId });
  }

  /** Revoke a channel's access. */
  removeChannelParticipant(canvasId: string, channelId: string): Promise<void> {
    return this.call(canvasesOperations.removeChannelParticipant, { canvasId, channelId });
  }

  /** Change a user's role on a canvas. */
  updateParticipantRole(
    canvasId: string,
    userId: string,
    role: CanvasRole
  ): Promise<void> {
    return this.call(canvasesOperations.updateParticipantRole, { canvasId, userId, role });
  }

  /** Change a group's role on a canvas. */
  updateGroupParticipantRole(
    canvasId: string,
    userGroupId: string,
    role: CanvasRole
  ): Promise<void> {
    return this.call(canvasesOperations.updateGroupParticipantRole, {
      canvasId,
      userGroupId,
      role,
    });
  }

  /** Change a channel's role on a canvas. */
  updateChannelParticipantRole(
    canvasId: string,
    channelId: string,
    role: CanvasRole
  ): Promise<void> {
    return this.call(canvasesOperations.updateChannelParticipantRole, {
      canvasId,
      channelId,
      role,
    });
  }

  // ----- Comments -----

  /** List a canvas's comment threads. */
  listCommentThreads(canvasId: string): Promise<CanvasCommentThread[]> {
    return this.call(canvasesOperations.listCommentThreads, { canvasId });
  }

  /** List the comments in a thread. */
  listThreadComments(threadId: string): Promise<CanvasComment[]> {
    return this.call(canvasesOperations.listThreadComments, { threadId });
  }

  /**
   * Start a comment thread anchored to a block.
   *
   * @param data.blockId - The BlockNote block the comment attaches to
   * @param data.anchorText - The highlighted text the comment refers to
   * @returns The ids of the new thread and its first comment
   *
   * @example
   * const { threadId } = await sdk.canvases.createCommentThread({
   *   canvasId: 'canvas-1',
   *   blockId: 'block-7',
   *   body: 'Should this be a table?',
   * });
   */
  async createCommentThread(data: {
    canvasId: string;
    blockId: string;
    body: string;
    anchorText?: string;
    mentionedUserIds?: string[];
  }): Promise<{ threadId: string; commentId: string }> {
    const threadId = newId();
    const commentId = newId();
    await this.call(canvasesOperations.createCommentThread, {
      threadId,
      commentId,
      ...data,
    });
    return { threadId, commentId };
  }

  /**
   * Reply in a comment thread.
   *
   * @returns The id of the new comment
   */
  async replyToThread(data: {
    threadId: string;
    canvasId: string;
    body: string;
    mentionedUserIds?: string[];
  }): Promise<{ commentId: string }> {
    const commentId = newId();
    await this.call(canvasesOperations.replyToThread, { commentId, ...data });
    return { commentId };
  }

  /** Edit a comment. */
  updateComment(
    commentId: string,
    body: string,
    options?: { mentionedUserIds?: string[] }
  ): Promise<void> {
    return this.call(canvasesOperations.updateComment, { commentId, body, ...options });
  }

  /** Delete a comment. */
  deleteComment(commentId: string): Promise<void> {
    return this.call(canvasesOperations.deleteComment, { commentId });
  }

  /** Resolve or reopen a comment thread. */
  setThreadStatus(threadId: string, status: CanvasCommentThreadStatus): Promise<void> {
    return this.call(canvasesOperations.setThreadStatus, { threadId, status });
  }

  // ----- Versions -----

  /**
   * Snapshot the current content as a named version.
   *
   * @param data.contentHash - Caller-computed hash used to skip duplicate saves
   * @returns The id of the new version
   */
  async saveVersion(data: {
    canvasId: string;
    name: string;
    content: unknown;
    contentHash: string;
  }): Promise<{ id: string }> {
    const id = newId();
    await this.call(canvasesOperations.saveVersion, { id, ...data });
    return { id };
  }

  /** Rename a saved version. */
  renameVersion(id: string, name: string): Promise<void> {
    return this.call(canvasesOperations.renameVersion, { id, name });
  }

  /** Restore a canvas to a saved version. */
  restoreVersion(id: string): Promise<void> {
    return this.call(canvasesOperations.restoreVersion, { id });
  }

  // ----- Folders -----

  /** List the current user's personal canvas folders. */
  listPersonalFolders(): Promise<CanvasFolder[]> {
    return this.call(canvasesOperations.listPersonalFolders, undefined);
  }

  /** List a channel's canvas folders. */
  listChannelFolders(channelId: string): Promise<CanvasFolder[]> {
    return this.call(canvasesOperations.listChannelFolders, { channelId });
  }

  /** List a project's canvas folders. */
  listProjectFolders(projectId: string): Promise<CanvasFolder[]> {
    return this.call(canvasesOperations.listProjectFolders, { projectId });
  }

  /**
   * Create a canvas folder.
   *
   * @returns The id of the new folder
   */
  async createFolder(data: {
    name: string;
    projectId?: string;
    channelId?: string;
  }): Promise<{ id: string }> {
    const id = newId();
    await this.call(canvasesOperations.createFolder, { id, ...data });
    return { id };
  }

  /** Rename a folder. */
  updateFolder(id: string, name: string): Promise<void> {
    return this.call(canvasesOperations.updateFolder, { id, name });
  }

  /** Delete a folder. */
  deleteFolder(id: string): Promise<void> {
    return this.call(canvasesOperations.deleteFolder, { id });
  }
}
