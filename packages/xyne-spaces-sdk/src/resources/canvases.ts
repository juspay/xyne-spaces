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
   * List the caller's canvases, newest first.
   *
   * @param options.limit - Page size.
   * @param options.start - Cursor from the previous page.
   * @param options.includeQuartoDocs - Include Quarto documents as well.
   * @param options.direction - Page forward or backward from the cursor.
   * @returns One page of canvases.
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

  /**
   * List the caller's Quarto documents.
   *
   * @param options.limit - Page size.
   * @param options.start - Cursor from the previous page.
   * @param options.direction - Page forward or backward from the cursor.
   * @returns One page of Quarto documents.
   * @example
   * const docs = await sdk.canvases.listQuartoDocs({ limit: 20 });
   */
  listQuartoDocs(options?: {
    limit?: number;
    start?: CanvasCursor;
    direction?: 'forward' | 'backward';
  }): Promise<Canvas[]> {
    return this.call(canvasesOperations.listQuartoDocs, options ?? {});
  }

  /**
   * List the canvases in a channel.
   *
   * @param channelId - Channel to read.
   * @param options.includeQuartoDocs - Include Quarto documents as well.
   * @returns The channel's canvases.
   * @example
   * const canvases = await sdk.canvases.listByChannel('channel-1');
   */
  listByChannel(
    channelId: string,
    options?: { limit?: number; start?: CanvasCursor; includeQuartoDocs?: boolean }
  ): Promise<Canvas[]> {
    return this.call(canvasesOperations.listByChannel, { channelId, ...options });
  }

  /**
   * List the Quarto documents in a channel.
   *
   * @param channelId - Channel to read.
   * @returns The channel's Quarto documents.
   * @example
   * const docs = await sdk.canvases.listQuartoDocsByChannel('channel-1');
   */
  listQuartoDocsByChannel(
    channelId: string,
    options?: { limit?: number; start?: CanvasCursor }
  ): Promise<Canvas[]> {
    return this.call(canvasesOperations.listQuartoDocsByChannel, { channelId, ...options });
  }

  /**
   * List the canvases in a project folder.
   *
   * @param folderId - Folder to read.
   * @param projectId - Project the folder belongs to.
   * @param options.includeQuartoDocs - Include Quarto documents as well.
   * @returns The folder's canvases.
   * @example
   * const canvases = await sdk.canvases.listByFolder('folder-1', 'proj-1');
   */
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
   * @param options.scope - Which level of the tree to read.
   * @param options.channelId - Required for `channel` and `channel_root`.
   * @param options.folderId - Required for `folder`.
   * @param options.projectId - Project the folder belongs to.
   * @param options.includeQuartoDocs - Include Quarto documents as well.
   * @returns The canvases at that level.
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

  /**
   * Get one canvas, including its content.
   *
   * @param canvasId - Id of the canvas.
   * @returns The canvas, or `null` if it does not exist or is not visible.
   * @example
   * const canvas = await sdk.canvases.get('canvas-1');
   */
  get(canvasId: string): Promise<Canvas | null> {
    return this.call(canvasesOperations.get, { canvasId });
  }

  /**
   * List everyone with access to a canvas — users, groups and channels.
   *
   * @param canvasId - Id of the canvas.
   * @returns One participant row per grant, with its role.
   * @example
   * const participants = await sdk.canvases.listParticipants('canvas-1');
   */
  listParticipants(canvasId: string): Promise<CanvasParticipant[]> {
    return this.call(canvasesOperations.listParticipants, { canvasId });
  }

  /**
   * List a canvas's saved versions, newest first.
   *
   * @param canvasId - Id of the canvas.
   * @returns Its version snapshots.
   * @example
   * const versions = await sdk.canvases.listVersions('canvas-1');
   */
  listVersions(canvasId: string): Promise<CanvasVersion[]> {
    return this.call(canvasesOperations.listVersions, { canvasId });
  }

  /**
   * Create a canvas.
   *
   * `content` is a BlockNote block array, not markdown. The creator becomes the
   * first participant, and share-link tokens are minted immediately.
   *
   * @param data.title - Display title.
   * @param data.content - Initial content, as a BlockNote block array.
   * @param data.channelId - Channel to file it under.
   * @param data.folderId - Folder to file it in.
   * @param data.projectId - Project the folder belongs to.
   * @param data.visibility - Who can see it.
   * @returns The new canvas's id.
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
   *
   * @param id - Id of the canvas.
   * @param data - Fields to change; omitted fields are left alone.
   * @param data.title - New title.
   * @param data.content - New content, as a BlockNote block array.
   * @param data.visibility - New visibility.
   * @param data.isCollaborative - Hand content ownership to the realtime server.
   * @param data.folderId - Move it to another folder.
   * @param data.projectId - Move it to another project.
   * @param data.channelId - Move it to another channel.
   * @example
   * await sdk.canvases.update('canvas-1', { title: 'Design notes v2' });
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

  /**
   * Delete a canvas.
   *
   * @param id - Id of the canvas.
   * @example
   * await sdk.canvases.delete('canvas-1');
   */
  delete(id: string): Promise<void> {
    return this.call(canvasesOperations.delete, { id });
  }

  /**
   * Star or unstar a canvas for the caller.
   *
   * This flips the current state rather than setting it.
   *
   * @param id - Id of the star row.
   * @param canvasId - Canvas being starred.
   * @example
   * await sdk.canvases.toggleStarred('star-1', 'canvas-1');
   */
  toggleStarred(id: string, canvasId: string): Promise<void> {
    return this.call(canvasesOperations.toggleStarred, { id, canvasId });
  }

  // ----- Sharing -----

  /**
   * Grant one or more users access to a canvas.
   *
   * @param canvasId - Canvas to share.
   * @param userIds - People to grant access to.
   * @param role - What they may do.
   * @example
   * await sdk.canvases.addParticipants('canvas-1', ['user-1'], 'EDITOR');
   */
  addParticipants(canvasId: string, userIds: string[], role: CanvasRole): Promise<void> {
    return this.call(canvasesOperations.addParticipants, { canvasId, userIds, role });
  }

  /**
   * Grant a user group access to a canvas.
   *
   * @param canvasId - Canvas to share.
   * @param userGroupId - Group to grant access to.
   * @param role - What its members may do.
   * @example
   * await sdk.canvases.addGroupParticipant('canvas-1', 'group-1', 'VIEWER');
   */
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

  /**
   * Grant a channel's members access to a canvas.
   *
   * @param canvasId - Canvas to share.
   * @param channelId - Channel whose members gain access.
   * @param role - What they may do.
   * @example
   * await sdk.canvases.addChannelParticipant('canvas-1', 'channel-1', 'VIEWER');
   */
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

  /**
   * Revoke one user's access to a canvas.
   *
   * @param canvasId - Canvas to unshare.
   * @param userId - Person losing access.
   * @example
   * await sdk.canvases.removeParticipant('canvas-1', 'user-1');
   */
  removeParticipant(canvasId: string, userId: string): Promise<void> {
    return this.call(canvasesOperations.removeParticipant, { canvasId, userId });
  }

  /**
   * Revoke a group's access to a canvas.
   *
   * @param canvasId - Canvas to unshare.
   * @param userGroupId - Group losing access.
   * @example
   * await sdk.canvases.removeGroupParticipant('canvas-1', 'group-1');
   */
  removeGroupParticipant(canvasId: string, userGroupId: string): Promise<void> {
    return this.call(canvasesOperations.removeGroupParticipant, { canvasId, userGroupId });
  }

  /**
   * Revoke a channel's access to a canvas.
   *
   * @param canvasId - Canvas to unshare.
   * @param channelId - Channel losing access.
   * @example
   * await sdk.canvases.removeChannelParticipant('canvas-1', 'channel-1');
   */
  removeChannelParticipant(canvasId: string, channelId: string): Promise<void> {
    return this.call(canvasesOperations.removeChannelParticipant, { canvasId, channelId });
  }

  /**
   * Change one user's role on a canvas.
   *
   * @param canvasId - Canvas the grant is on.
   * @param userId - Person whose role changes.
   * @param role - Their new role.
   * @example
   * await sdk.canvases.updateParticipantRole('canvas-1', 'user-1', 'VIEWER');
   */
  updateParticipantRole(
    canvasId: string,
    userId: string,
    role: CanvasRole
  ): Promise<void> {
    return this.call(canvasesOperations.updateParticipantRole, { canvasId, userId, role });
  }

  /**
   * Change a group's role on a canvas.
   *
   * @param canvasId - Canvas the grant is on.
   * @param userGroupId - Group whose role changes.
   * @param role - Its new role.
   * @example
   * await sdk.canvases.updateGroupParticipantRole('canvas-1', 'group-1', 'EDITOR');
   */
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

  /**
   * Change a channel's role on a canvas.
   *
   * @param canvasId - Canvas the grant is on.
   * @param channelId - Channel whose role changes.
   * @param role - Its new role.
   * @example
   * await sdk.canvases.updateChannelParticipantRole('canvas-1', 'channel-1', 'VIEWER');
   */
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

  /**
   * List a canvas's comment threads.
   *
   * @param canvasId - Id of the canvas.
   * @returns Its threads, resolved and open.
   * @example
   * const threads = await sdk.canvases.listCommentThreads('canvas-1');
   */
  listCommentThreads(canvasId: string): Promise<CanvasCommentThread[]> {
    return this.call(canvasesOperations.listCommentThreads, { canvasId });
  }

  /**
   * List the comments in one thread, oldest first.
   *
   * @param threadId - Id of the thread.
   * @returns Its comments.
   * @example
   * const comments = await sdk.canvases.listThreadComments('thread-1');
   */
  listThreadComments(threadId: string): Promise<CanvasComment[]> {
    return this.call(canvasesOperations.listThreadComments, { threadId });
  }

  /**
   * Start a comment thread anchored to a block.
   *
   * @param data.canvasId - Canvas being commented on.
   * @param data.blockId - The BlockNote block the comment attaches to.
   * @param data.body - The comment text.
   * @param data.anchorText - The highlighted text the comment refers to.
   * @param data.mentionedUserIds - People to notify.
   * @returns The ids of the new thread and its first comment.
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
   * @param data.threadId - Thread to reply in.
   * @param data.canvasId - Canvas the thread is on.
   * @param data.body - The reply text.
   * @param data.mentionedUserIds - People to notify.
   * @returns The new comment's id.
   * @example
   * const { commentId } = await sdk.canvases.replyToThread({
   *   threadId: 'thread-1',
   *   canvasId: 'canvas-1',
   *   body: 'Agreed.',
   * });
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

  /**
   * Edit a comment.
   *
   * @param commentId - Comment to edit.
   * @param body - The replacement text.
   * @param mentionedUserIds - People to notify.
   * @example
   * await sdk.canvases.updateComment('comment-1', 'Rewritten.');
   */
  updateComment(
    commentId: string,
    body: string,
    options?: { mentionedUserIds?: string[] }
  ): Promise<void> {
    return this.call(canvasesOperations.updateComment, { commentId, body, ...options });
  }

  /**
   * Delete a comment.
   *
   * @param commentId - Comment to delete.
   * @example
   * await sdk.canvases.deleteComment('comment-1');
   */
  deleteComment(commentId: string): Promise<void> {
    return this.call(canvasesOperations.deleteComment, { commentId });
  }

  /**
   * Resolve or reopen a comment thread.
   *
   * @param threadId - Thread to change.
   * @param status - Whether it is open or resolved.
   * @example
   * await sdk.canvases.setThreadStatus('thread-1', 'RESOLVED');
   */
  setThreadStatus(threadId: string, status: CanvasCommentThreadStatus): Promise<void> {
    return this.call(canvasesOperations.setThreadStatus, { threadId, status });
  }

  // ----- Versions -----

  /**
   * Snapshot the current content as a named version.
   *
   * @param data.canvasId - Canvas to snapshot.
   * @param data.name - Name for the version.
   * @param data.content - The content to store, as a BlockNote block array.
   * @param data.contentHash - Caller-computed hash used to skip duplicate saves.
   * @returns The new version's id.
   * @example
   * const { id } = await sdk.canvases.saveVersion({
   *   canvasId: 'canvas-1',
   *   name: 'Before rewrite',
   *   content,
   *   contentHash: hash,
   * });
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

  /**
   * Rename a saved version.
   *
   * @param id - Id of the version.
   * @param name - New name.
   * @example
   * await sdk.canvases.renameVersion('version-1', 'Before rewrite');
   */
  renameVersion(id: string, name: string): Promise<void> {
    return this.call(canvasesOperations.renameVersion, { id, name });
  }

  /**
   * Restore a canvas to one of its saved versions.
   *
   * @param id - Id of the version to restore.
   * @example
   * await sdk.canvases.restoreVersion('version-1');
   */
  restoreVersion(id: string): Promise<void> {
    return this.call(canvasesOperations.restoreVersion, { id });
  }

  // ----- Folders -----

  /**
   * List the caller's personal canvas folders.
   *
   * @returns Their own folders, not those owned by a channel or project.
   * @example
   * const folders = await sdk.canvases.listPersonalFolders();
   */
  listPersonalFolders(): Promise<CanvasFolder[]> {
    return this.call(canvasesOperations.listPersonalFolders, undefined);
  }

  /**
   * List a channel's canvas folders.
   *
   * @param channelId - Channel to read.
   * @returns Its folders.
   * @example
   * const folders = await sdk.canvases.listChannelFolders('channel-1');
   */
  listChannelFolders(channelId: string): Promise<CanvasFolder[]> {
    return this.call(canvasesOperations.listChannelFolders, { channelId });
  }

  /**
   * List a project's canvas folders.
   *
   * @param projectId - Project to read.
   * @returns Its folders.
   * @example
   * const folders = await sdk.canvases.listProjectFolders('proj-1');
   */
  listProjectFolders(projectId: string): Promise<CanvasFolder[]> {
    return this.call(canvasesOperations.listProjectFolders, { projectId });
  }

  /**
   * Create a canvas folder.
   *
   * @param data.name - Display name.
   * @param data.projectId - Project to create it in.
   * @param data.channelId - Channel to create it in. Omit both for a personal folder.
   * @returns The new folder's id.
   * @example
   * const { id } = await sdk.canvases.createFolder({ name: 'Runbooks' });
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

  /**
   * Rename a canvas folder.
   *
   * @param id - Id of the folder.
   * @param name - New name.
   * @example
   * await sdk.canvases.updateFolder('folder-1', 'Runbooks');
   */
  updateFolder(id: string, name: string): Promise<void> {
    return this.call(canvasesOperations.updateFolder, { id, name });
  }

  /**
   * Delete a canvas folder.
   *
   * @param id - Id of the folder.
   * @example
   * await sdk.canvases.deleteFolder('folder-1');
   */
  deleteFolder(id: string): Promise<void> {
    return this.call(canvasesOperations.deleteFolder, { id });
  }
  /**
   * Archive a canvas, hiding it from the default listings.
   *
   * @param canvasId - Id of the canvas.
   * @example
   * await sdk.canvases.archive('canvas-1');
   */
  archive(canvasId: string): Promise<void> {
    return this.call(canvasesOperations.archive, { canvasId });
  }

  /**
   * Restore an archived canvas to the default listings.
   *
   * @param canvasId - Id of the canvas.
   * @example
   * await sdk.canvases.unarchive('canvas-1');
   */
  unarchive(canvasId: string): Promise<void> {
    return this.call(canvasesOperations.unarchive, { canvasId });
  }
}
