import { Router, type Request, type Response, type NextFunction } from 'express';
import { randomUUID, createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { convert } from 'html-to-text';
import { normalizeStoragePath } from '@xyne/storage';
import { db } from '../database/client';
import { storageService, getStorageService } from '../services/storage/index';
import { config } from '../config/env';
import { assertAttachmentAccess } from '../services/attachmentAccessService';
import { setSafeDownloadHeaders } from '../utils/safeAttachmentDownload';
import { logger } from '../utils/logger';
import { canReadFeedSource, validSelection, parseFeedRange } from '../services/feedPolicy';
import {
  findFeedPost,
  findFeedPostCursor,
  listFeedPosts,
  findFeedRequest,
  insertFeedPublication,
  getFeedPost,
  updateFeedPostBody,
  deleteFeedPost,
  listFeedPostMedia,
  setFeedLike,
  findFeedCommentCursor,
  listFeedComments,
  addFeedComment,
  updateFeedComment,
  deleteFeedComment,
  reportFeedPost,
  listFeedReports,
  findFeedMedia,
} from '../bypassAcl/feedRepository';

const router = Router();
type Identity = {
  id: string;
  workspaceId: string;
  role: string;
  workspaceName: string;
};
type Media = {
  id: string;
  filename: string;
  mimetype: string;
  size: number;
  path: string;
};
class FeedError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}
function fail(status: number, message: string): never {
  throw new FeedError(status, message);
}
function text(value: unknown, max = 5000): string {
  if (typeof value !== 'string' || value.length > max)
    fail(400, `Text must be at most ${max} characters.`);
  return value.trim();
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(value))
    fail(400, 'Invalid identifier.');
  return value;
}
function requestId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/i.test(value))
    fail(400, 'A request ID is required.');
  return value;
}
const handle =
  (fn: (req: Request, res: Response, user: Identity) => Promise<void>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (process.env.WORKSPACE_FEED_ENABLED !== 'true')
        fail(404, 'Feed is not enabled on this server.');
      const workspaceId = id(req.params.workspaceId);
      if (!req.user?.id || req.user.workspaceId !== workspaceId)
        fail(403, 'Workspace access required.');
      const member = await db.user.findFirst({
        where: { id: req.user.id, workspaceId, status: 'ACTIVE', leftAt: null },
        select: { id: true, role: true, workspace: { select: { name: true } } },
      });
      if (!member) fail(403, 'Workspace access required.');
      res.setHeader('Cache-Control', 'private, no-store');
      await fn(req, res, {
        id: member.id,
        workspaceId,
        role: member.role,
        workspaceName: member.workspace.name,
      });
    } catch (error) {
      if (res.headersSent) {
        next(error);
        return;
      }
      if (error instanceof FeedError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error('Feed request failed', { error });
      res.status(500).json({
        error: 'Unable to complete this feed request. Please try again.',
      });
    }
  };
async function source(conversationId: string, user: Identity) {
  const conversation = await db.conversation.findFirst({
    where: { conversationId, workspaceId: user.workspaceId },
    include: { channel: true },
  });
  if (!conversation) fail(404, 'Conversation not found.');
  const member = await db.channelParticipant.findFirst({
    where: {
      channelId: conversation.channelId,
      userId: user.id,
      workspaceId: user.workspaceId,
    },
  });
  if (!canReadFeedSource(conversation.channel, user.workspaceId, !!member))
    fail(403, 'You cannot publish this conversation.');
  return conversation;
}
async function snapshots(conversationId: string, ids: string[], user: Identity, publishing = true) {
  await source(conversationId, user);
  const messages = await db.message.findMany({
    where: {
      conversationId,
      workspaceId: user.workspaceId,
      messageId: { in: ids },
      isDeleted: false,
      isSent: true,
      msgType: { not: 'SYSTEM' },
      OR: [{ visibleTo: null }, { visibleTo: user.id }],
    },
    include: {
      sender: { select: { id: true, name: true, displayName: true } },
    },
    orderBy: [{ createdAt: 'asc' }, { messageId: 'asc' }],
  });
  if (messages.length !== ids.length)
    fail(403, 'Some selected messages are no longer available to publish.');
  const attachments = await db.messageAttachment.findMany({
    where: {
      workspaceId: user.workspaceId,
      conversationId,
      entityId: { in: ids },
      entityType: 'CHAT',
      isDeleted: false,
    },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  });
  if (
    publishing &&
    (attachments.length > 20 ||
      attachments.some((a) => a.size > 100 * 1024 * 1024) ||
      attachments.reduce((sum, a) => sum + a.size, 0) > 250 * 1024 * 1024)
  )
    fail(400, 'Share up to 20 files, 100 MB per file and 250 MB total.');
  for (const attachment of attachments) {
    const access = await assertAttachmentAccess(attachment, user.id, user.workspaceId);
    if (!access.ok) fail(403, 'You cannot publish one of these attachments.');
    if (
      publishing &&
      (!attachment.url || (attachment.uploadStatus && attachment.uploadStatus !== 'COMPLETED'))
    )
      fail(409, 'Wait for all attachments to finish uploading.');
  }
  return { messages, attachments };
}
async function getPost(postId: string, user: Identity) {
  const post = await findFeedPost(user.workspaceId, postId);
  if (!post) fail(404, 'Post not found.');
  return post;
}
const revision = (message: unknown, attachments: unknown): string =>
  createHash('sha256').update(JSON.stringify({ message, attachments })).digest('hex');
const isAdmin = (user: Identity) => user.role === 'ADMIN' || user.role === 'OWNER';

router.get(
  '/workspaces/:workspaceId/posts',
  handle(async (req, res, user) => {
    let before;
    if (req.query.before) {
      before = await findFeedPostCursor(user.workspaceId, id(req.query.before));
      if (!before) fail(400, 'Invalid feed cursor.');
    }
    const posts = await listFeedPosts(user.workspaceId, user.id, req.query.mine === 'true', before);
    res.json({
      posts: posts.slice(0, 20),
      nextCursor: posts.length > 20 ? posts[19].id : null,
      viewerId: user.id,
      canModerate: isAdmin(user),
      workspaceName: user.workspaceName,
    });
  })
);
router.get(
  '/workspaces/:workspaceId/source/:conversationId',
  handle(async (req, res, user) => {
    const conversationId = id(req.params.conversationId);
    const conversation = await source(conversationId, user);
    const after = req.query.after ? id(req.query.after) : undefined;
    if (
      after &&
      !(await db.message.findFirst({
        where: {
          messageId: after,
          conversationId,
          workspaceId: user.workspaceId,
        },
      }))
    )
      fail(400, 'Invalid cursor.');
    const messages = await db.message.findMany({
      where: {
        conversationId,
        workspaceId: user.workspaceId,
        isDeleted: false,
        isSent: true,
        msgType: { not: 'SYSTEM' },
        OR: [{ visibleTo: null }, { visibleTo: user.id }],
      },
      orderBy: [{ createdAt: 'asc' }, { messageId: 'asc' }],
      take: 51,
      ...(after ? { cursor: { messageId: after }, skip: 1 } : {}),
    });
    const pageIds = messages.slice(0, 50).map((m) => m.messageId);
    if (req.query.selected && !pageIds.includes(id(req.query.selected)))
      pageIds.push(id(req.query.selected));
    const data = await snapshots(conversationId, pageIds, user, false);
    res.json({
      workspaceName: user.workspaceName,
      privateSource:
        conversation.channel.visibility !== 'PUBLIC' ||
        ['DM', 'GROUP_DM'].includes(conversation.channel.scopeType),
      nextCursor: messages.length > 50 ? messages[49].messageId : null,
      messages: data.messages.map((m) => ({
        id: m.messageId,
        revision: revision(
          m,
          data.attachments.filter((a) => a.entityId === m.messageId)
        ),
        author: {
          id: m.sender.id,
          name: m.sender.displayName || m.sender.name,
        },
        text: convert(m.content, {
          wordwrap: false,
          selectors: [{ selector: 'img', format: 'skip' }],
        }),
        createdAt: m.createdAt,
        media: data.attachments
          .filter((a) => a.entityId === m.messageId)
          .map((a) => ({
            id: a.id,
            filename: a.originalFilename,
            mimetype: a.mimetype,
            size: a.size,
          })),
      })),
    });
  })
);
router.post(
  '/workspaces/:workspaceId/posts',
  handle(async (req, res, user) => {
    const body = text(req.body.body ?? '');
    const key = requestId(req.body.requestId);
    const ids: unknown = req.body.messageIds ?? [];
    if (!validSelection(ids)) fail(400, 'Select up to 10 distinct messages.');
    if (!body && !ids.length) fail(400, 'Write a post or select messages.');
    if (req.body.confirmWorkspacePublication !== true)
      fail(400, 'Confirm publication to the entire workspace.');
    const existing = await findFeedRequest(user.workspaceId, user.id, key);
    if (existing) {
      res.json(existing);
      return;
    }
    const conversationId = ids.length ? id(req.body.conversationId) : null;
    const data = conversationId
      ? await snapshots(conversationId, ids, user)
      : { messages: [], attachments: [] };
    for (const message of data.messages) {
      if (
        req.body.revisions?.[message.messageId] !==
        revision(
          message,
          data.attachments.filter((a) => a.entityId === message.messageId)
        )
      )
        fail(409, 'The selected messages changed. Reopen the sharing preview.');
    }
    const postId = randomUUID();
    const copied: (Media & { sourceAttachmentId: string })[] = [];
    let committed = false;
    try {
      for (const attachment of data.attachments) {
        const mediaId = randomUUID();
        const path = `workspace-feed/${user.workspaceId}/${postId}/${mediaId}`;
        copied.push({
          id: mediaId,
          path,
          filename: attachment.originalFilename,
          mimetype: attachment.mimetype,
          size: attachment.size,
          sourceAttachmentId: attachment.id,
        });
        const metadata = attachment.metadata as { type?: string } | null;
        const provider = ['transcript', 'identified_transcript', 'recording'].includes(
          metadata?.type ?? ''
        )
          ? getStorageService(config.gcs.transcriptionBucketName)
          : storageService;
        const originalPath = normalizeStoragePath(attachment.url);
        if (!originalPath) fail(409, 'An attachment is not ready.');
        const info = await provider.getFileMetadata(originalPath);
        if (Number(info.size) !== attachment.size)
          fail(409, 'An attachment changed. Reopen the sharing preview.');
        await storageService.uploadStreamToPath(await provider.createReadStream(originalPath), {
          path,
          contentType: attachment.mimetype,
          ifNotExists: true,
        });
      }
      // Recheck permissions and content after potentially slow media copies.
      const current = conversationId ? await snapshots(conversationId, ids, user) : data;
      if (JSON.stringify(current) !== JSON.stringify(data))
        fail(409, 'The selected messages changed. Reopen the sharing preview.');
      const excerpts = data.messages.map((m) => ({
        author: {
          id: m.sender.id,
          name: m.sender.displayName || m.sender.name,
        },
        text: convert(m.content, {
          wordwrap: false,
          selectors: [{ selector: 'img', format: 'skip' }],
        }),
        createdAt: m.createdAt.toISOString(),
        media: data.attachments
          .filter((a) => a.entityId === m.messageId)
          .map((a) => {
            const media = copied.find((c) => c.sourceAttachmentId === a.id)!;
            return {
              id: media.id,
              filename: media.filename,
              mimetype: media.mimetype,
              size: media.size,
            };
          }),
      }));
      const result = await insertFeedPublication({
        postId,
        workspaceId: user.workspaceId,
        authorId: user.id,
        body,
        excerpts,
        conversationId,
        messageIds: ids,
        requestId: key,
        media: copied.map((media) => ({ ...media, postId, workspaceId: user.workspaceId })),
      });
      committed = result !== null;
      if (!result) {
        const winner = await findFeedRequest(user.workspaceId, user.id, key);
        res.json(winner);
      } else res.status(201).json({ id: result });
    } finally {
      if (!committed)
        await Promise.allSettled(copied.map((m) => storageService.deleteFile(m.path)));
    }
  })
);
router.get(
  '/workspaces/:workspaceId/posts/:postId',
  handle(async (req, res, user) => {
    const post = await getFeedPost(user.workspaceId, user.id, id(req.params.postId));
    if (!post) fail(404, 'Post not found.');
    res.json({ post, viewerId: user.id, canModerate: isAdmin(user) });
  })
);
router.patch(
  '/workspaces/:workspaceId/posts/:postId',
  handle(async (req, res, user) => {
    const post = await getPost(id(req.params.postId), user);
    if (post.authorId !== user.id) fail(403, 'Only the publisher can edit this post.');
    const body = text(req.body.body);
    const changed = await updateFeedPostBody(user.workspaceId, post.id, body);
    if (!changed) fail(400, 'A post cannot be empty.');
    res.json({ ok: true });
  })
);
router.delete(
  '/workspaces/:workspaceId/posts/:postId',
  handle(async (req, res, user) => {
    const post = await getPost(id(req.params.postId), user);
    if (post.authorId !== user.id && !isAdmin(user))
      fail(403, 'Only the publisher or an administrator can remove this post.');
    await deleteFeedPost(user.workspaceId, post.id);
    const media = await listFeedPostMedia(user.workspaceId, post.id);
    const cleanup = await Promise.allSettled(media.map((m) => storageService.deleteFile(m.path)));
    if (cleanup.some((r) => r.status === 'rejected'))
      logger.warn('Feed media cleanup needs retry', { postId: post.id });
    res.json({ ok: true });
  })
);
router.put(
  '/workspaces/:workspaceId/posts/:postId/like',
  handle(async (req, res, user) => {
    const post = await getPost(id(req.params.postId), user);
    if (typeof req.body.liked !== 'boolean') fail(400, 'liked must be a boolean.');
    await setFeedLike(user.workspaceId, post.id, user.id, req.body.liked);
    res.json({ ok: true });
  })
);
router.get(
  '/workspaces/:workspaceId/posts/:postId/comments',
  handle(async (req, res, user) => {
    const post = await getPost(id(req.params.postId), user);
    let after;
    if (req.query.after) {
      after = await findFeedCommentCursor(post.id, id(req.query.after));
      if (!after) fail(400, 'Invalid comment cursor.');
    }
    const rows = await listFeedComments(post.id, after);
    res.json({
      comments: rows.slice(0, 50),
      nextCursor: rows.length > 50 ? rows[49].id : null,
    });
  })
);
router.post(
  '/workspaces/:workspaceId/posts/:postId/comments',
  handle(async (req, res, user) => {
    const post = await getPost(id(req.params.postId), user);
    const body = text(req.body.body, 2000);
    if (!body) fail(400, 'Write a comment first.');
    const key = requestId(req.body.requestId);
    const comment = await addFeedComment(post.id, user.id, body, key, randomUUID());
    res.json(comment);
  })
);
router.patch(
  '/workspaces/:workspaceId/posts/:postId/comments/:commentId',
  handle(async (req, res, user) => {
    const post = await getPost(id(req.params.postId), user);
    const body = text(req.body.body, 2000);
    if (!body) fail(400, 'A comment cannot be empty.');
    const changed = await updateFeedComment(post.id, id(req.params.commentId), user.id, body);
    if (!changed) fail(404, 'Comment not found.');
    res.json({ ok: true });
  })
);
router.delete(
  '/workspaces/:workspaceId/posts/:postId/comments/:commentId',
  handle(async (req, res, user) => {
    const post = await getPost(id(req.params.postId), user);
    await deleteFeedComment(post.id, id(req.params.commentId), user.id, isAdmin(user));
    res.json({ ok: true });
  })
);
router.post(
  '/workspaces/:workspaceId/posts/:postId/report',
  handle(async (req, res, user) => {
    const post = await getPost(id(req.params.postId), user);
    const reason = text(req.body.reason, 1000);
    if (!reason) fail(400, 'A reason is required.');
    await reportFeedPost(post.id, user.id, reason);
    res.json({ ok: true });
  })
);
router.get(
  '/workspaces/:workspaceId/reports',
  handle(async (_req, res, user) => {
    if (!isAdmin(user)) fail(403, 'Administrator access required.');
    res.json(await listFeedReports(user.workspaceId));
  })
);
router.get(
  '/workspaces/:workspaceId/media/:mediaId',
  handle(async (req, res, user) => {
    const media = await findFeedMedia(user.workspaceId, id(req.params.mediaId));
    if (!media) fail(404, 'Media not found.');
    const metadata = await storageService.getFileMetadata(media.path);
    const size = Number(metadata.size);
    if (!Number.isSafeInteger(size) || size < 0) fail(404, 'Media unavailable.');
    let range;
    try {
      range = parseFeedRange(req.headers.range, size);
    } catch {
      res.setHeader('Content-Range', `bytes */${size}`);
      res.status(416).end();
      return;
    }
    setSafeDownloadHeaders(res, {
      mimetype: media.mimetype,
      filename: media.filename,
    });
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', range ? range.end - range.start + 1 : size);
    if (range) {
      res.status(206);
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
    }
    await pipeline(await storageService.createReadStream(media.path, range ?? undefined), res);
  })
);
export default router;
