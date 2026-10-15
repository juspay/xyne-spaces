import { Prisma } from '@prisma/client';
import { db } from '../database/client';
import { rawQuery, transaction } from './base';

const sql = Prisma.sql;

export type FeedMediaRow = {
  id: string;
  postId: string;
  workspaceId: string;
  sourceAttachmentId: string;
  path: string;
  filename: string;
  mimetype: string;
  size: number;
};

export type FeedPostRow = {
  id: string;
  authorId: string;
  body: string;
  excerpts: unknown[];
  createdAt: Date;
  updatedAt: Date;
  authorName: string;
  likeCount: number;
  commentCount: number;
  liked: boolean;
};

const postSelect = (workspaceId: string, viewerId: string) =>
  sql`SELECT p.id, p."authorId", p.body, p.excerpts, p."createdAt", p."updatedAt", COALESCE(u."displayName", u.name, 'Former member') AS "authorName", (SELECT count(*)::int FROM non_zero.feed_likes l WHERE l."postId"=p.id) AS "likeCount", (SELECT count(*)::int FROM non_zero.feed_comments c WHERE c."postId"=p.id) AS "commentCount", EXISTS(SELECT 1 FROM non_zero.feed_likes l WHERE l."postId"=p.id AND l."userId"=${viewerId}) AS liked FROM non_zero.feed_posts p LEFT JOIN users u ON u.id=p."authorId" WHERE p."workspaceId"=${workspaceId} AND p."deletedAt" IS NULL`;

export function findFeedPost(
  workspaceId: string,
  postId: string
): Promise<{ id: string; authorId: string } | null> {
  return rawQuery(['FeedPost'], 'Find a live feed post within one workspace', async () => {
    const rows = await db.$queryRaw<{ id: string; authorId: string }[]>(
      sql`SELECT id, "authorId" FROM non_zero.feed_posts WHERE id=${postId} AND "workspaceId"=${workspaceId} AND "deletedAt" IS NULL`
    );
    return rows[0] ?? null;
  });
}

export function findFeedPostCursor(
  workspaceId: string,
  postId: string
): Promise<{ createdAt: Date; id: string } | null> {
  return rawQuery(['FeedPost'], 'Resolve a workspace-scoped feed cursor', async () => {
    const rows = await db.$queryRaw<{ createdAt: Date; id: string }[]>(
      sql`SELECT id, "createdAt" FROM non_zero.feed_posts WHERE id=${postId} AND "workspaceId"=${workspaceId}`
    );
    return rows[0] ?? null;
  });
}

export function listFeedPosts(
  workspaceId: string,
  viewerId: string,
  mine: boolean,
  before?: { createdAt: Date; id: string }
): Promise<FeedPostRow[]> {
  return rawQuery(
    ['FeedPost', 'FeedLike', 'FeedComment', 'User'],
    'List workspace feed posts with viewer counts',
    () => {
      const owner = mine ? sql`AND p."authorId"=${viewerId}` : Prisma.empty;
      const cursor = before
        ? sql`AND (p."createdAt",p.id) < (${before.createdAt},${before.id})`
        : Prisma.empty;
      return db.$queryRaw<FeedPostRow[]>(
        sql`${postSelect(workspaceId, viewerId)} ${owner} ${cursor} ORDER BY p."createdAt" DESC, p.id DESC LIMIT 21`
      );
    }
  );
}

export function findFeedRequest(
  workspaceId: string,
  authorId: string,
  requestId: string
): Promise<{ id: string } | null> {
  return rawQuery(['FeedPost'], 'Resolve a scoped feed publication retry', async () => {
    const rows = await db.$queryRaw<{ id: string }[]>(
      sql`SELECT id FROM non_zero.feed_posts WHERE "workspaceId"=${workspaceId} AND "authorId"=${authorId} AND "requestId"=${requestId}`
    );
    return rows[0] ?? null;
  });
}

export type FeedPublicationInput = {
  postId: string;
  workspaceId: string;
  authorId: string;
  body: string;
  excerpts: unknown[];
  conversationId: string | null;
  messageIds: string[];
  requestId: string;
  media: FeedMediaRow[];
};

export function insertFeedPublication(input: FeedPublicationInput): Promise<string | null> {
  return transaction(
    ['FeedPost', 'FeedMedia'],
    'Atomically publish a workspace feed snapshot and its media',
    db,
    async (tx) => {
      const inserted = await rawQuery(['FeedPost'], 'Insert idempotent workspace feed post', () =>
        tx.$queryRaw<{ id: string }[]>(
          sql`INSERT INTO non_zero.feed_posts (id,"workspaceId","authorId",body,excerpts,"sourceConversationId","sourceMessageIds","requestId") VALUES (${input.postId},${input.workspaceId},${input.authorId},${input.body},${JSON.stringify(input.excerpts)}::jsonb,${input.conversationId},${JSON.stringify(input.messageIds)}::jsonb,${input.requestId}) ON CONFLICT ("workspaceId","authorId","requestId") DO NOTHING RETURNING id`
        )
      );
      if (!inserted[0]) return null;
      for (const media of input.media) {
        await rawQuery(['FeedMedia'], 'Attach copied media to the new workspace feed post', () =>
          tx.$executeRaw(
            sql`INSERT INTO non_zero.feed_media (id,"postId","workspaceId","sourceAttachmentId",path,filename,mimetype,size) VALUES (${media.id},${input.postId},${input.workspaceId},${media.sourceAttachmentId},${media.path},${media.filename},${media.mimetype},${media.size})`
          )
        );
      }
      return input.postId;
    }
  );
}

export function getFeedPost(
  workspaceId: string,
  viewerId: string,
  postId: string
): Promise<FeedPostRow | null> {
  return rawQuery(
    ['FeedPost', 'FeedLike', 'FeedComment', 'User'],
    'Read one workspace feed post',
    async () => {
      const rows = await db.$queryRaw<FeedPostRow[]>(
        sql`${postSelect(workspaceId, viewerId)} AND p.id=${postId}`
      );
      return rows[0] ?? null;
    }
  );
}

export function updateFeedPostBody(
  workspaceId: string,
  postId: string,
  body: string
): Promise<number> {
  return rawQuery(['FeedPost'], 'Edit a live workspace feed post', () =>
    db.$executeRaw(
      sql`UPDATE non_zero.feed_posts SET body=${body}, "updatedAt"=CURRENT_TIMESTAMP WHERE id=${postId} AND "workspaceId"=${workspaceId} AND "deletedAt" IS NULL AND (${body} <> '' OR jsonb_array_length(excerpts)>0)`
    )
  );
}

export function deleteFeedPost(workspaceId: string, postId: string): Promise<number> {
  return rawQuery(['FeedPost'], 'Tombstone a workspace feed post', () =>
    db.$executeRaw(
      sql`UPDATE non_zero.feed_posts SET "deletedAt"=CURRENT_TIMESTAMP, body='', excerpts='[]'::jsonb WHERE id=${postId} AND "workspaceId"=${workspaceId} AND "deletedAt" IS NULL`
    )
  );
}

export function listFeedPostMedia(workspaceId: string, postId: string): Promise<FeedMediaRow[]> {
  return rawQuery(['FeedMedia'], 'List feed media for post cleanup in one workspace', () =>
    db.$queryRaw<FeedMediaRow[]>(
      sql`SELECT * FROM non_zero.feed_media WHERE "postId"=${postId} AND "workspaceId"=${workspaceId}`
    )
  );
}

export function setFeedLike(
  workspaceId: string,
  postId: string,
  userId: string,
  liked: boolean
): Promise<number> {
  return rawQuery(['FeedLike', 'FeedPost'], 'Set a member like on a workspace feed post', () =>
    liked
      ? db.$executeRaw(
          sql`INSERT INTO non_zero.feed_likes ("postId","userId") SELECT p.id,${userId} FROM non_zero.feed_posts p WHERE p.id=${postId} AND p."workspaceId"=${workspaceId} AND p."deletedAt" IS NULL ON CONFLICT DO NOTHING`
        )
      : db.$executeRaw(
          sql`DELETE FROM non_zero.feed_likes WHERE "postId"=${postId} AND "userId"=${userId}`
        )
  );
}

export function findFeedCommentCursor(
  postId: string,
  commentId: string
): Promise<{ id: string; createdAt: Date } | null> {
  return rawQuery(['FeedComment'], 'Resolve a feed comment cursor for one post', async () => {
    const rows = await db.$queryRaw<{ id: string; createdAt: Date }[]>(
      sql`SELECT id,"createdAt" FROM non_zero.feed_comments WHERE id=${commentId} AND "postId"=${postId}`
    );
    return rows[0] ?? null;
  });
}

export function listFeedComments(
  postId: string,
  after?: { id: string; createdAt: Date }
): Promise<Record<string, unknown>[]> {
  return rawQuery(['FeedComment', 'User'], 'List comments on an authorized feed post', () => {
    const cursor = after
      ? sql`AND (c."createdAt",c.id) > (${after.createdAt},${after.id})`
      : Prisma.empty;
    return db.$queryRaw<Record<string, unknown>[]>(
      sql`SELECT c.*, COALESCE(u."displayName",u.name,'Former member') AS "authorName" FROM non_zero.feed_comments c LEFT JOIN users u ON u.id=c."authorId" WHERE c."postId"=${postId} ${cursor} ORDER BY c."createdAt",c.id LIMIT 51`
    );
  });
}

export function addFeedComment(
  postId: string,
  authorId: string,
  body: string,
  requestId: string,
  commentId: string
): Promise<{ id: string }> {
  return rawQuery(['FeedComment'], 'Idempotently add a comment to an authorized post', async () => {
    const rows = await db.$queryRaw<{ id: string }[]>(
      sql`INSERT INTO non_zero.feed_comments (id,"postId","authorId",body,"requestId") VALUES (${commentId},${postId},${authorId},${body},${requestId}) ON CONFLICT ("postId","authorId","requestId") DO UPDATE SET "requestId"=EXCLUDED."requestId" RETURNING id`
    );
    return rows[0];
  });
}

export function updateFeedComment(
  postId: string,
  commentId: string,
  authorId: string,
  body: string
): Promise<number> {
  return rawQuery(['FeedComment'], 'Edit an authored feed comment', () =>
    db.$executeRaw(
      sql`UPDATE non_zero.feed_comments SET body=${body},"updatedAt"=CURRENT_TIMESTAMP WHERE id=${commentId} AND "postId"=${postId} AND "authorId"=${authorId}`
    )
  );
}

export function deleteFeedComment(
  postId: string,
  commentId: string,
  userId: string,
  admin: boolean
): Promise<number> {
  return rawQuery(['FeedComment'], 'Remove an authored or moderated feed comment', () =>
    db.$executeRaw(
      sql`DELETE FROM non_zero.feed_comments WHERE id=${commentId} AND "postId"=${postId} AND ("authorId"=${userId} OR ${admin})`
    )
  );
}

export function reportFeedPost(postId: string, userId: string, reason: string): Promise<number> {
  return rawQuery(['FeedReport'], 'Record a member report for an authorized feed post', () =>
    db.$executeRaw(
      sql`INSERT INTO non_zero.feed_reports ("postId","userId",reason) VALUES (${postId},${userId},${reason}) ON CONFLICT ("postId","userId") DO UPDATE SET reason=EXCLUDED.reason`
    )
  );
}

export function listFeedReports(workspaceId: string): Promise<Record<string, unknown>[]> {
  return rawQuery(
    ['FeedReport', 'FeedPost'],
    'List open feed reports for workspace administrators',
    () =>
      db.$queryRaw<Record<string, unknown>[]>(
        sql`SELECT r.* FROM non_zero.feed_reports r JOIN non_zero.feed_posts p ON p.id=r."postId" WHERE p."workspaceId"=${workspaceId} AND p."deletedAt" IS NULL ORDER BY r."createdAt" DESC LIMIT 100`
      )
  );
}

export function findFeedMedia(workspaceId: string, mediaId: string): Promise<FeedMediaRow | null> {
  return rawQuery(
    ['FeedMedia', 'FeedPost'],
    'Authorize workspace feed media download',
    async () => {
      const rows = await db.$queryRaw<FeedMediaRow[]>(
        sql`SELECT m.* FROM non_zero.feed_media m JOIN non_zero.feed_posts p ON p.id=m."postId" WHERE m.id=${mediaId} AND m."workspaceId"=${workspaceId} AND p."workspaceId"=${workspaceId} AND p."deletedAt" IS NULL`
      );
      return rows[0] ?? null;
    }
  );
}
