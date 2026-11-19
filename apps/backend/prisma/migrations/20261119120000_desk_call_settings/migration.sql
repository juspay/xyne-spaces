-- CreateTable — Prisma model: DeskCallSettings. REST-only (not synced via Zero), so it lives in "non_zero".
CREATE TABLE "non_zero"."desk_call_settings" (
    "channelId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "routingKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ticketRules" JSONB,
    "phoneFieldNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "desk_call_settings_pkey" PRIMARY KEY ("channelId")
);

-- CreateIndex
CREATE INDEX "desk_call_settings_connectionId_idx" ON "non_zero"."desk_call_settings"("connectionId");

-- CreateIndex
CREATE INDEX "desk_call_settings_workspaceId_idx" ON "non_zero"."desk_call_settings"("workspaceId");

-- At most one default desk per connection. Prisma cannot express a partial unique index, so it is created by hand.
CREATE UNIQUE INDEX "desk_call_settings_one_default" ON "non_zero"."desk_call_settings"("connectionId") WHERE "isDefault";
