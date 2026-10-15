-- Additive only. Feed snapshots and media do not change chat permissions.
CREATE TABLE non_zero.feed_posts (
  id TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, "authorId" TEXT NOT NULL,
  body TEXT NOT NULL, excerpts JSONB NOT NULL DEFAULT '[]',
  "sourceConversationId" TEXT, "sourceMessageIds" JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3), "requestId" TEXT NOT NULL,
  UNIQUE ("workspaceId", "authorId", "requestId")
);
CREATE INDEX feed_posts_workspace_created ON non_zero.feed_posts ("workspaceId", "createdAt" DESC, id DESC);
CREATE TABLE non_zero.feed_media (
  id TEXT PRIMARY KEY, "postId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL, "sourceAttachmentId" TEXT NOT NULL,
  path TEXT NOT NULL, filename TEXT NOT NULL, mimetype TEXT NOT NULL, size INTEGER NOT NULL
);
CREATE INDEX feed_media_post ON non_zero.feed_media ("postId");
CREATE TABLE non_zero.feed_likes (
  "postId" TEXT NOT NULL,
  "userId" TEXT NOT NULL, PRIMARY KEY ("postId", "userId")
);
CREATE TABLE non_zero.feed_comments (
  id TEXT PRIMARY KEY, "postId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL, body TEXT NOT NULL, "requestId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("postId", "authorId", "requestId")
);
CREATE INDEX feed_comments_post_created ON non_zero.feed_comments ("postId", "createdAt", id);
CREATE TABLE non_zero.feed_reports (
  "postId" TEXT NOT NULL,
  "userId" TEXT NOT NULL, reason TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("postId", "userId")
);
