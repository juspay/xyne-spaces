-- CreateTable
CREATE TABLE "non_zero"."auth_sessions" (
    "id" TEXT NOT NULL,
    "orgMemberId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "deviceKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "platform" TEXT NOT NULL,
    "refreshTokenExpiry" TIMESTAMP(3) NOT NULL,
    "deviceInfo" TEXT,
    "fcmToken" TEXT,
    "voipToken" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."auth_session_workspace_access" (
    "id" TEXT NOT NULL,
    "authSessionId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_session_workspace_access_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_refreshToken_key" ON "non_zero"."auth_sessions"("refreshToken");

-- Hand-written (Prisma cannot express partial indexes): at most one ACTIVE session per
-- (org member, device). Login revokes-then-inserts and refresh rotates in place, so the code
-- relies on it. Also serves every lookup, since they all filter status = 'active'.
CREATE UNIQUE INDEX "auth_sessions_active_device_key" ON "non_zero"."auth_sessions"("orgMemberId", "deviceKey") WHERE "status" = 'active';

-- CreateIndex
CREATE INDEX "auth_sessions_deviceKey_idx" ON "non_zero"."auth_sessions"("deviceKey");

-- CreateIndex
CREATE INDEX "auth_session_workspace_access_workspaceId_idx" ON "non_zero"."auth_session_workspace_access"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "auth_session_workspace_access_authSessionId_workspaceId_key" ON "non_zero"."auth_session_workspace_access"("authSessionId", "workspaceId");
