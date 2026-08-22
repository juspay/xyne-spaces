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

import { query, mutator } from './types.js';
import { newId, now } from '../core/ids.js';
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
   * Maps to: Zero query 'userCanvasesPaginated'
   */
  list: query<
    {
      limit?: number;
      start?: CanvasCursor;
      includeQuartoDocs?: boolean;
      direction?: 'forward' | 'backward';
    },
    Canvas[]
  >('userCanvasesPaginated', {
    mapArgs: (args) => ({
      limit: args.limit ?? 50,
      start: args.start ?? null,
      ...(args.includeQuartoDocs !== undefined
        ? { includeQuartoDocs: args.includeQuartoDocs }
        : {}),
      ...(args.direction ? { direction: args.direction } : {}),
    }),
  }),

  /**
   * The current user's Quarto documents.
   * Maps to: Zero query 'userQuartoDocsPaginated'
   */
  listQuartoDocs: query<
    { limit?: number; start?: CanvasCursor; direction?: 'forward' | 'backward' },
    Canvas[]
  >('userQuartoDocsPaginated', {
    mapArgs: (args) => ({
      limit: args.limit ?? 50,
      start: args.start ?? null,
      ...(args.direction ? { direction: args.direction } : {}),
    }),
  }),

  /**
   * Canvases in a channel.
   * Maps to: Zero query 'channelCanvasesPaginated'
   */
  listByChannel: query<
    { channelId: string; limit?: number; start?: CanvasCursor; includeQuartoDocs?: boolean },
    Canvas[]
  >('channelCanvasesPaginated', {
    mapArgs: (args) => ({
      channelId: args.channelId,
      limit: args.limit ?? 50,
      start: args.start ?? null,
      ...(args.includeQuartoDocs !== undefined
        ? { includeQuartoDocs: args.includeQuartoDocs }
        : {}),
    }),
  }),

  /**
   * Quarto documents in a channel.
   * Maps to: Zero query 'channelQuartoDocsPaginated'
   */
  listQuartoDocsByChannel: query<
    { channelId: string; limit?: number; start?: CanvasCursor },
    Canvas[]
  >('channelQuartoDocsPaginated', {
    mapArgs: (args) => ({
      channelId: args.channelId,
      limit: args.limit ?? 50,
      start: args.start ?? null,
    }),
  }),

  /**
   * Canvases in a folder within a project.
   * Maps to: Zero query 'projectFolderCanvases'
   */
  listByFolder: query<
    { folderId: string; projectId: string; includeQuartoDocs?: boolean },
    Canvas[]
  >('projectFolderCanvases'),

  /**
   * Canvases at one level of the folder tree.
   *
   * The scope decides which id is required: `folder` needs `folderId`,
   * `channel` and `channel_root` need `channelId`, and `personal_root` needs
   * neither. Supplying both, or the wrong one, is rejected.
   * Maps to: Zero query 'hierarchyCanvases'
   */
  listHierarchy: query<
    {
      scope?: CanvasScope;
      channelId?: string;
      folderId?: string;
      projectId?: string;
      includeQuartoDocs?: boolean;
    },
    Canvas[]
  >('hierarchyCanvases'),

  /**
   * One canvas.
   * Maps to: Zero query 'getCanvas'
   */
  get: query<{ canvasId: string }, Canvas | null>('getCanvas'),

  /**
   * A canvas's participants — users, groups, and channels with access.
   * Maps to: Zero query 'canvasParticipants'
   */
  listParticipants: query<{ canvasId: string }, CanvasParticipant[]>('canvasParticipants'),

  /**
   * Saved versions of a canvas.
   * Maps to: Zero query 'canvasVersions'
   */
  listVersions: query<{ canvasId: string }, CanvasVersion[]>('canvasVersions'),

  /**
   * Comment threads on a canvas.
   * Maps to: Zero query 'canvasCommentThreads'
   */
  listCommentThreads: query<{ canvasId: string }, CanvasCommentThread[]>(
    'canvasCommentThreads'
  ),

  /**
   * Comments within one thread.
   * Maps to: Zero query 'canvasThreadComments'
   */
  listThreadComments: query<{ threadId: string }, CanvasComment[]>('canvasThreadComments'),

  // ----- Folders -----

  /**
   * The current user's personal folders.
   * Maps to: Zero query 'personalCanvasFolders'
   */
  listPersonalFolders: query<void, CanvasFolder[]>('personalCanvasFolders'),

  /**
   * Folders in a channel.
   * Maps to: Zero query 'channelCanvasFolders'
   */
  listChannelFolders: query<{ channelId: string }, CanvasFolder[]>('channelCanvasFolders'),

  /**
   * Folders in a project.
   * Maps to: Zero query 'projectCanvasFolders'
   */
  listProjectFolders: query<{ projectId: string }, CanvasFolder[]>('projectCanvasFolders'),

  /**
   * Create a folder.
   * Maps to: Zero mutator 'canvasFolder.create'
   */
  createFolder: mutator<
    { id: string; name: string; projectId?: string; channelId?: string },
    void
  >('canvasFolder.create', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),

  /**
   * Rename a folder.
   * Maps to: Zero mutator 'canvasFolder.update'
   */
  updateFolder: mutator<{ id: string; name?: string }, void>('canvasFolder.update', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),

  /**
   * Delete a folder.
   * Maps to: Zero mutator 'canvasFolder.delete'
   */
  deleteFolder: mutator<{ id: string }, void>('canvasFolder.delete'),

  // ----- Writes -----

  /**
   * Create a canvas. The creator becomes its first participant.
   * Maps to: Zero mutator 'canvas.create'
   */
  create: mutator<
    {
      id: string;
      title: string;
      content?: unknown;
      channelId?: string;
      folderId?: string;
      projectId?: string;
      visibility?: CanvasVisibility;
    },
    void
  >('canvas.create', {
    mapArgs: (args) => ({
      ...args,
      timestamp: now(),
      participantId: newId(),
      // Share-link tokens, minted up front so the canvas is shareable at once.
      viewAccessId: newId(),
      editAccessId: newId(),
    }),
  }),

  /**
   * Update a canvas's title, content, placement, or visibility.
   * Maps to: Zero mutator 'canvas.update'
   */
  update: mutator<
    {
      id: string;
      title?: string;
      content?: unknown;
      visibility?: CanvasVisibility;
      isCollaborative?: boolean;
      folderId?: string;
      projectId?: string;
      channelId?: string;
    },
    void
  >('canvas.update', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),

  /**
   * Delete a canvas.
   * Maps to: Zero mutator 'canvas.delete'
   */
  delete: mutator<{ id: string }, void>('canvas.delete'),

  /**
   * Star or unstar a canvas for the current user.
   * Maps to: Zero mutator 'canvasUserStatus.toggleStarred'
   */
  toggleStarred: mutator<{ id: string; canvasId: string }, void>(
    'canvasUserStatus.toggleStarred',
    {
      mapArgs: (args) => ({ ...args, timestamp: now() }),
    }
  ),

  // ----- Participants -----

  /**
   * Grant users access to a canvas.
   * Maps to: Zero mutator 'canvas.addParticipants'
   */
  addParticipants: mutator<
    { canvasId: string; userIds: string[]; role: CanvasRole },
    void
  >('canvas.addParticipants', {
    mapArgs: (args) => ({
      canvasId: args.canvasId,
      userIds: args.userIds,
      role: args.role,
      timestamp: now(),
      participantIds: args.userIds.map(() => newId()),
    }),
  }),

  /**
   * Grant a user group access.
   * Maps to: Zero mutator 'canvas.addGroupParticipant'
   */
  addGroupParticipant: mutator<
    { canvasId: string; userGroupId: string; role: CanvasRole },
    void
  >('canvas.addGroupParticipant', {
    mapArgs: (args) => ({ ...args, participantId: newId(), timestamp: now() }),
  }),

  /**
   * Grant a whole channel access.
   * Maps to: Zero mutator 'canvas.addChannelParticipant'
   */
  addChannelParticipant: mutator<
    { canvasId: string; channelId: string; role: CanvasRole },
    void
  >('canvas.addChannelParticipant', {
    mapArgs: (args) => ({ ...args, participantId: newId(), timestamp: now() }),
  }),

  /**
   * Revoke a user's access.
   * Maps to: Zero mutator 'canvas.removeParticipant'
   */
  removeParticipant: mutator<{ canvasId: string; userId: string }, void>(
    'canvas.removeParticipant'
  ),

  /**
   * Revoke a group's access.
   * Maps to: Zero mutator 'canvas.removeGroupParticipant'
   */
  removeGroupParticipant: mutator<{ canvasId: string; userGroupId: string }, void>(
    'canvas.removeGroupParticipant'
  ),

  /**
   * Revoke a channel's access.
   * Maps to: Zero mutator 'canvas.removeChannelParticipant'
   */
  removeChannelParticipant: mutator<{ canvasId: string; channelId: string }, void>(
    'canvas.removeChannelParticipant'
  ),

  /**
   * Change a user's role.
   * Maps to: Zero mutator 'canvas.updateParticipantRole'
   */
  updateParticipantRole: mutator<
    { canvasId: string; userId: string; role: CanvasRole },
    void
  >('canvas.updateParticipantRole', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),

  /**
   * Change a group's role.
   * Maps to: Zero mutator 'canvas.updateGroupParticipantRole'
   */
  updateGroupParticipantRole: mutator<
    { canvasId: string; userGroupId: string; role: CanvasRole },
    void
  >('canvas.updateGroupParticipantRole', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),

  /**
   * Change a channel's role.
   * Maps to: Zero mutator 'canvas.updateChannelParticipantRole'
   */
  updateChannelParticipantRole: mutator<
    { canvasId: string; channelId: string; role: CanvasRole },
    void
  >('canvas.updateChannelParticipantRole', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),

  // ----- Comments -----

  /**
   * Start a comment thread anchored to a block.
   * Maps to: Zero mutator 'canvasComment.createThread'
   */
  createCommentThread: mutator<
    {
      threadId: string;
      commentId: string;
      canvasId: string;
      blockId: string;
      body: string;
      anchorText?: string;
      mentionedUserIds?: string[];
    },
    void
  >('canvasComment.createThread', {
    mapArgs: (args) => ({
      threadId: args.threadId,
      commentId: args.commentId,
      canvasId: args.canvasId,
      blockId: args.blockId,
      body: args.body,
      ...(args.anchorText ? { anchorText: args.anchorText } : {}),
      mentionedUserIds: args.mentionedUserIds ?? [],
      timestamp: now(),
    }),
  }),

  /**
   * Reply in a thread.
   * Maps to: Zero mutator 'canvasComment.reply'
   */
  replyToThread: mutator<
    {
      commentId: string;
      threadId: string;
      canvasId: string;
      body: string;
      mentionedUserIds?: string[];
    },
    void
  >('canvasComment.reply', {
    mapArgs: (args) => ({
      commentId: args.commentId,
      threadId: args.threadId,
      canvasId: args.canvasId,
      body: args.body,
      mentionedUserIds: args.mentionedUserIds ?? [],
      timestamp: now(),
    }),
  }),

  /**
   * Edit a comment.
   * Maps to: Zero mutator 'canvasComment.updateComment'
   */
  updateComment: mutator<
    { commentId: string; body: string; mentionedUserIds?: string[] },
    void
  >('canvasComment.updateComment', {
    mapArgs: (args) => ({
      commentId: args.commentId,
      body: args.body,
      mentionedUserIds: args.mentionedUserIds ?? [],
      timestamp: now(),
    }),
  }),

  /**
   * Delete a comment.
   * Maps to: Zero mutator 'canvasComment.deleteComment'
   */
  deleteComment: mutator<{ commentId: string }, void>('canvasComment.deleteComment', {
    mapArgs: (args) => ({ commentId: args.commentId, timestamp: now() }),
  }),

  /**
   * Resolve or reopen a thread.
   * Maps to: Zero mutator 'canvasComment.setThreadStatus'
   */
  setThreadStatus: mutator<
    { threadId: string; status: CanvasCommentThreadStatus },
    void
  >('canvasComment.setThreadStatus', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),

  // ----- Versions -----

  /**
   * Snapshot the current content as a named version.
   * Maps to: Zero mutator 'canvasVersion.save'
   */
  saveVersion: mutator<
    { id: string; canvasId: string; name: string; content: unknown; contentHash: string },
    void
  >('canvasVersion.save', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),

  /**
   * Rename a saved version.
   * Maps to: Zero mutator 'canvasVersion.rename'
   */
  renameVersion: mutator<{ id: string; name: string }, void>('canvasVersion.rename'),

  /**
   * Restore a canvas to a saved version.
   * Maps to: Zero mutator 'canvasVersion.restore'
   */
  restoreVersion: mutator<{ id: string }, void>('canvasVersion.restore', {
    mapArgs: (args) => ({ id: args.id, timestamp: now() }),
  }),

  /**
   * Archive a canvas, hiding it from the default listings.
   * Maps to: Zero mutator 'canvas.archiveCanvas'
   */
  archive: mutator<{ canvasId: string }, void>('canvas.archiveCanvas'),

  /**
   * Restore an archived canvas.
   * Maps to: Zero mutator 'canvas.unarchiveCanvas'
   */
  unarchive: mutator<{ canvasId: string }, void>('canvas.unarchiveCanvas'),
} as const;
