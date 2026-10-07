-- One opaque session per device/browser (see src/auth/). The table is created here, so it is
-- empty and untouched until the new image serves traffic: every index on it, including the
-- partial UNIQUE ones, is created plainly inside the migration transaction. workflow.user_sessions
-- is read-only legacy from now on and keeps all its indexes.

-- CreateTable
CREATE TABLE "non_zero"."auth_sessions" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "legacySessionId" TEXT,
    "deviceKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "platform" TEXT NOT NULL DEFAULT 'WEB',
    "absoluteExpiry" TIMESTAMP(3) NOT NULL,
    "deviceInfo" TEXT,
    "fcmToken" TEXT,
    "voipToken" TEXT,
    "pushPlatform" TEXT,
    "appVersion" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "non_zero"."auth_sessions" ADD CONSTRAINT "auth_sessions_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "public"."org_members"("memberId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex (declared in schema.prisma)
CREATE UNIQUE INDEX "auth_sessions_tokenHash_key" ON "non_zero"."auth_sessions"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_legacySessionId_key" ON "non_zero"."auth_sessions"("legacySessionId");

-- CreateIndex
CREATE INDEX "auth_sessions_accountId_status_idx" ON "non_zero"."auth_sessions"("accountId", "status");

-- CreateIndex
CREATE INDEX "auth_sessions_status_absoluteExpiry_idx" ON "non_zero"."auth_sessions"("status", "absoluteExpiry");

-- CreateIndex
CREATE INDEX "auth_sessions_deviceKey_idx" ON "non_zero"."auth_sessions"("deviceKey");

-- Partial uniques (SQL only; Prisma cannot express them, precedent draft_messages):
-- one ACTIVE session per device, one ACTIVE owner per push token.
CREATE UNIQUE INDEX "auth_sessions_active_deviceKey_key" ON "non_zero"."auth_sessions"("deviceKey")
  WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "auth_sessions_active_fcmToken_key" ON "non_zero"."auth_sessions"("fcmToken")
  WHERE "status" = 'ACTIVE' AND "fcmToken" IS NOT NULL;
CREATE UNIQUE INDEX "auth_sessions_active_voipToken_key" ON "non_zero"."auth_sessions"("voipToken")
  WHERE "status" = 'ACTIVE' AND "voipToken" IS NOT NULL;

-- public.users carries live rows: the hot membership read {orgMemberId, workspaceId} gets its
-- index without locking writes. Must be the LAST statement: CONCURRENTLY cannot run inside a
-- transaction block (precedent: 20260722120000_twin_drafts_in_draft_messages).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "users_orgMemberId_workspaceId_idx" ON "public"."users"("orgMemberId", "workspaceId");
