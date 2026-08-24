-- Slack-Connect (cross-workspace shared channels). Additive only: three new
-- tables plus one new column on channels. No data backfill and no changes to
-- existing columns, so this is safe under a rolling deployment. See
-- slack-connect-solution.md for the full design.

-- AlterTable: mark channels connect-capable (enables the invite UI). Orthogonal
-- to scopeType; true even with zero connect_channel rows.
ALTER TABLE "public"."channels"
    ADD COLUMN "isConnectEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable: connect_channel — one row per (host channel <-> guest workspace).
CREATE TABLE "public"."connect_channel" (
    "id" TEXT NOT NULL,
    "hostChannelId" TEXT NOT NULL,
    "hostWorkspaceId" TEXT NOT NULL,
    "guestWorkspaceId" TEXT NOT NULL,
    "guestChannelId" TEXT,
    "status" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connect_channel_pkey" PRIMARY KEY ("id")
);

-- One link per (channel, guest org). Its leading column also serves
-- "which orgs is this channel shared with" (WHERE hostChannelId = ?), so no
-- separate hostChannelId index is needed.
CREATE UNIQUE INDEX "connect_channel_hostChannelId_guestWorkspaceId_key"
    ON "public"."connect_channel"("hostChannelId", "guestWorkspaceId");

-- CreateTable: connect_channel_member — one flat member list keyed by the host
-- channel. Host + guest members live here together (leftAt tombstones departures).
CREATE TABLE "public"."connect_channel_member" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userWorkspaceId" TEXT NOT NULL,
    "leftAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connect_channel_member_pkey" PRIMARY KEY ("id")
);

-- No duplicate members; also indexes channelId prefix -> member list.
CREATE UNIQUE INDEX "connect_channel_member_channelId_userId_key"
    ON "public"."connect_channel_member"("channelId", "userId");

-- Reachability: "which connect channels is this user in".
CREATE INDEX "connect_channel_member_userId_channelId_idx"
    ON "public"."connect_channel_member"("userId", "channelId");

-- CreateTable: connect_request — the host<->guest invite/approval handshake.
-- Readable by both orgs; also serves as an audit log of rejected/expired attempts.
CREATE TABLE "non_zero"."connect_request" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "hostWorkspaceId" TEXT NOT NULL,
    "invitedBy" TEXT NOT NULL,
    "inviteEmail" TEXT NOT NULL,
    "inviteToken" TEXT NOT NULL,
    "guestUserId" TEXT,
    "guestWorkspaceId" TEXT,
    "guestEntityConfig" JSONB,
    "status" TEXT NOT NULL,
    "hostAdminApprovedBy" TEXT,
    "hostAdminApprovedAt" TIMESTAMP(3),
    "guestAcceptedAt" TIMESTAMP(3),
    "guestAdminApprovedBy" TEXT,
    "guestAdminApprovedAt" TIMESTAMP(3),
    "rejectedBy" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connect_request_pkey" PRIMARY KEY ("id")
);

-- Accept-URL id must be unique.
CREATE UNIQUE INDEX "connect_request_inviteToken_key"
    ON "non_zero"."connect_request"("inviteToken");

-- Host admin outbox.
CREATE INDEX "connect_request_hostWorkspaceId_status_idx"
    ON "non_zero"."connect_request"("hostWorkspaceId", "status");

-- Guest admin inbox.
CREATE INDEX "connect_request_guestWorkspaceId_status_idx"
    ON "non_zero"."connect_request"("guestWorkspaceId", "status");

-- Guest member inbox (pre-resolution, by email).
CREATE INDEX "connect_request_inviteEmail_status_idx"
    ON "non_zero"."connect_request"("inviteEmail", "status");
