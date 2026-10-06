-- Account-level auth sessions + per-workspace grants (see src/auth/). Both tables start
-- empty, so plain (non-concurrent) index creation is fine here.

-- CreateTable
CREATE TABLE "non_zero"."auth_sessions" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "tokenHash" TEXT,
    "legacySessionId" TEXT,
    "deviceKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "platform" TEXT NOT NULL DEFAULT 'WEB',
    "aal" INTEGER NOT NULL DEFAULT 1,
    "amr" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "authenticatedAt" TIMESTAMP(3) NOT NULL,
    "absoluteExpiry" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "deviceInfo" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."session_workspace_grants" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "legacySessionId" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,

    CONSTRAINT "session_workspace_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_tokenHash_key" ON "non_zero"."auth_sessions"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_legacySessionId_key" ON "non_zero"."auth_sessions"("legacySessionId");

-- CreateIndex
CREATE INDEX "auth_sessions_accountId_status_idx" ON "non_zero"."auth_sessions"("accountId", "status");

-- CreateIndex
CREATE INDEX "auth_sessions_deviceKey_idx" ON "non_zero"."auth_sessions"("deviceKey");

-- CreateIndex
CREATE INDEX "auth_sessions_status_absoluteExpiry_idx" ON "non_zero"."auth_sessions"("status", "absoluteExpiry");

-- CreateIndex
CREATE INDEX "auth_sessions_orgId_idx" ON "non_zero"."auth_sessions"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "session_workspace_grants_legacySessionId_key" ON "non_zero"."session_workspace_grants"("legacySessionId");

-- CreateIndex
CREATE UNIQUE INDEX "session_workspace_grants_sessionId_workspaceId_key" ON "non_zero"."session_workspace_grants"("sessionId", "workspaceId");

-- CreateIndex
CREATE INDEX "session_workspace_grants_workspaceId_userId_idx" ON "non_zero"."session_workspace_grants"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "session_workspace_grants_userId_idx" ON "non_zero"."session_workspace_grants"("userId");

-- Legacy rows of one auth_session now share refreshToken (= session deviceKey), so the
-- unique constraint goes. The plain "user_sessions_refreshToken_idx" index stays.
-- Must be the last statement: CONCURRENTLY cannot run inside a transaction block
-- (precedent: 20260722120000_twin_drafts_in_draft_messages).
DROP INDEX CONCURRENTLY IF EXISTS "workflow"."user_sessions_refreshToken_key";
