/**
 * Canvases Operation Registry
 *
 * Collaborative documents, their folders, participants, inline comment threads,
 * and saved versions.
 *
 * Two things to know about content. It is a BlockNote block array rather than
 * markdown, so callers pass structured blocks. And when a canvas has
 * `isCollaborative` set, the realtime CRDT server owns the document — writing
 * through `update` in that state is not a safe read-modify-write, so prefer the
 * realtime editor or take a version snapshot first.
 */

import { op } from './types.js';
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

/** Page cursor for the paginated canvas listings. */
export interface CanvasCursor {
  id: string;
  updatedAt: number;
}

/** Where a hierarchy listing is rooted. */
export type CanvasScope = 'channel' | 'channel_root' | 'folder' | 'personal_root';

export const canvasesOperations = {
  // ----- Reads -----

  /**
   * The current user's canvases, newest first.
   */
  list: op<{
      limit?: number;
      start?: CanvasCursor;
      includeQuartoDocs?: boolean;
      direction?: 'forward' | 'backward';
    }, Canvas[]>('canvases.list', 'query'),

  /**
   * The current user's Quarto documents.
   */
  listQuartoDocs: op<{ limit?: number; start?: CanvasCursor; direction?: 'forward' | 'backward' }, Canvas[]>('canvases.listQuartoDocs', 'query'),

  /**
   * Canvases in a channel.
   */
  listByChannel: op<{ channelId: string; limit?: number; start?: CanvasCursor; includeQuartoDocs?: boolean }, Canvas[]>('canvases.listByChannel', 'query'),

  /**
   * Quarto documents in a channel.
   */
  listQuartoDocsByChannel: op<{ channelId: string; limit?: number; start?: CanvasCursor }, Canvas[]>('canvases.listQuartoDocsByChannel', 'query'),

  /**
   * Canvases in a folder within a project.
   */
  listByFolder: op<{ folderId: string; projectId: string; includeQuartoDocs?: boolean }, Canvas[]>('canvases.listByFolder', 'query'),

  /**
   * Canvases at one level of the folder tree.
   *
   * The scope decides which id is required: `folder` needs `folderId`,
   * `channel` and `channel_root` need `channelId`, and `personal_root` needs
   * neither. Supplying both, or the wrong one, is rejected.
   */
  listHierarchy: op<{
      scope?: CanvasScope;
      channelId?: string;
      folderId?: string;
      projectId?: string;
      includeQuartoDocs?: boolean;
    }, Canvas[]>('canvases.listHierarchy', 'query'),

  /**
   * One canvas.
   */
  get: op<{ canvasId: string }, Canvas | null>('canvases.get', 'query'),

  /**
   * A canvas's participants — users, groups, and channels with access.
   */
  listParticipants: op<{ canvasId: string }, CanvasParticipant[]>('canvases.listParticipants', 'query'),

  /**
   * Saved versions of a canvas.
   */
  listVersions: op<{ canvasId: string }, CanvasVersion[]>('canvases.listVersions', 'query'),

  /**
   * Comment threads on a canvas.
   */
  listCommentThreads: op<{ canvasId: string }, CanvasCommentThread[]>('canvases.listCommentThreads', 'query'),

  /**
   * Comments within one thread.
   */
  listThreadComments: op<{ threadId: string }, CanvasComment[]>('canvases.listThreadComments', 'query'),

  // ----- Folders -----

  /**
   * The current user's personal folders.
   */
  listPersonalFolders: op<void, CanvasFolder[]>('canvases.listPersonalFolders', 'query'),

  /**
   * Folders in a channel.
   */
  listChannelFolders: op<{ channelId: string }, CanvasFolder[]>('canvases.listChannelFolders', 'query'),

  /**
   * Folders in a project.
   */
  listProjectFolders: op<{ projectId: string }, CanvasFolder[]>('canvases.listProjectFolders', 'query'),

  /**
   * Create a folder.
   */
  createFolder: op<{ id: string; name: string; projectId?: string; channelId?: string }, void>('canvases.createFolder', 'mutator'),

  /**
   * Rename a folder.
   */
  updateFolder: op<{ id: string; name?: string }, void>('canvases.updateFolder', 'mutator'),

  /**
   * Delete a folder.
   */
  deleteFolder: op<{ id: string }, void>('canvases.deleteFolder', 'mutator'),

  // ----- Writes -----

  /**
   * Create a canvas. The creator becomes its first participant.
   */
  create: op<{
      id: string;
      title: string;
      content?: unknown;
      channelId?: string;
      folderId?: string;
      projectId?: string;
      visibility?: CanvasVisibility;
    }, void>('canvases.create', 'mutator'),

  /**
   * Update a canvas's title, content, placement, or visibility.
   */
  update: op<{
      id: string;
      title?: string;
      content?: unknown;
      visibility?: CanvasVisibility;
      isCollaborative?: boolean;
      folderId?: string;
      projectId?: string;
      channelId?: string;
    }, void>('canvases.update', 'mutator'),

  /**
   * Delete a canvas.
   */
  delete: op<{ id: string }, void>('canvases.delete', 'mutator'),

  /**
   * Star or unstar a canvas for the current user.
   */
  toggleStarred: op<{ id: string; canvasId: string }, void>('canvases.toggleStarred', 'mutator'),

  // ----- Participants -----

  /**
   * Grant users access to a canvas.
   */
  addParticipants: op<{ canvasId: string; userIds: string[]; role: CanvasRole }, void>('canvases.addParticipants', 'mutator'),

  /**
   * Grant a user group access.
   */
  addGroupParticipant: op<{ canvasId: string; userGroupId: string; role: CanvasRole }, void>('canvases.addGroupParticipant', 'mutator'),

  /**
   * Grant a whole channel access.
   */
  addChannelParticipant: op<{ canvasId: string; channelId: string; role: CanvasRole }, void>('canvases.addChannelParticipant', 'mutator'),

  /**
   * Revoke a user's access.
   */
  removeParticipant: op<{ canvasId: string; userId: string }, void>('canvases.removeParticipant', 'mutator'),

  /**
   * Revoke a group's access.
   */
  removeGroupParticipant: op<{ canvasId: string; userGroupId: string }, void>('canvases.removeGroupParticipant', 'mutator'),

  /**
   * Revoke a channel's access.
   */
  removeChannelParticipant: op<{ canvasId: string; channelId: string }, void>('canvases.removeChannelParticipant', 'mutator'),

  /**
   * Change a user's role.
   */
  updateParticipantRole: op<{ canvasId: string; userId: string; role: CanvasRole }, void>('canvases.updateParticipantRole', 'mutator'),

  /**
   * Change a group's role.
   */
  updateGroupParticipantRole: op<{ canvasId: string; userGroupId: string; role: CanvasRole }, void>('canvases.updateGroupParticipantRole', 'mutator'),

  /**
   * Change a channel's role.
   */
  updateChannelParticipantRole: op<{ canvasId: string; channelId: string; role: CanvasRole }, void>('canvases.updateChannelParticipantRole', 'mutator'),

  // ----- Comments -----

  /**
   * Start a comment thread anchored to a block.
   */
  createCommentThread: op<{
      threadId: string;
      commentId: string;
      canvasId: string;
      blockId: string;
      body: string;
      anchorText?: string;
      mentionedUserIds?: string[];
    }, void>('canvases.createCommentThread', 'mutator'),

  /**
   * Reply in a thread.
   */
  replyToThread: op<{
      commentId: string;
      threadId: string;
      canvasId: string;
      body: string;
      mentionedUserIds?: string[];
    }, void>('canvases.replyToThread', 'mutator'),

  /**
   * Edit a comment.
   */
  updateComment: op<{ commentId: string; body: string; mentionedUserIds?: string[] }, void>('canvases.updateComment', 'mutator'),

  /**
   * Delete a comment.
   */
  deleteComment: op<{ commentId: string }, void>('canvases.deleteComment', 'mutator'),

  /**
   * Resolve or reopen a thread.
   */
  setThreadStatus: op<{ threadId: string; status: CanvasCommentThreadStatus }, void>('canvases.setThreadStatus', 'mutator'),

  // ----- Versions -----

  /**
   * Snapshot the current content as a named version.
   */
  saveVersion: op<{ id: string; canvasId: string; name: string; content: unknown; contentHash: string }, void>('canvases.saveVersion', 'mutator'),

  /**
   * Rename a saved version.
   */
  renameVersion: op<{ id: string; name: string }, void>('canvases.renameVersion', 'mutator'),

  /**
   * Restore a canvas to a saved version.
   */
  restoreVersion: op<{ id: string }, void>('canvases.restoreVersion', 'mutator'),

  /**
   * Archive a canvas, hiding it from the default listings.
   */
  archive: op<{ canvasId: string }, void>('canvases.archive', 'mutator'),

  /**
   * Restore an archived canvas.
   */
  unarchive: op<{ canvasId: string }, void>('canvases.unarchive', 'mutator'),
} as const;
