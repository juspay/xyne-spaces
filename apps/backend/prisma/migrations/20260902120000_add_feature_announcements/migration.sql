-- CreateTable
CREATE TABLE "non_zero"."feature_announcements" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "pages" JSONB NOT NULL,
    "mediaKey" TEXT,
    "mediaAlt" TEXT,
    "ctaLabel" TEXT,
    "ctaType" TEXT,
    "ctaTarget" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "cacKey" TEXT,
    -- NULL means "every workspace". FeatureAnnouncementsACL must be registered or the
    -- tenant extension force-scopes this column and drops those rows from every read.
    "workspaceId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."user_surface_states" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "surfaceKind" TEXT NOT NULL,
    "surfaceKey" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3),
    "seenCount" INTEGER NOT NULL DEFAULT 0,
    "progress" INTEGER,
    "actedAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_surface_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "feature_announcements_key_key" ON "non_zero"."feature_announcements"("key");

-- CreateIndex
CREATE INDEX "feature_announcements_status_publishedAt_idx" ON "non_zero"."feature_announcements"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "feature_announcements_workspaceId_idx" ON "non_zero"."feature_announcements"("workspaceId");

-- CreateIndex
-- Enforces once-per-user-per-surface at the database, not just in app logic.
CREATE UNIQUE INDEX "user_surface_states_userId_surfaceKind_surfaceKey_key" ON "non_zero"."user_surface_states"("userId", "surfaceKind", "surfaceKey");

-- CreateIndex
CREATE INDEX "user_surface_states_workspaceId_userId_idx" ON "non_zero"."user_surface_states"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "user_surface_states_surfaceKind_surfaceKey_idx" ON "non_zero"."user_surface_states"("surfaceKind", "surfaceKey");
