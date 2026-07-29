-- CreateTable
CREATE TABLE "workflow"."activity_aliases" (
    "id" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "eventCategory" TEXT NOT NULL,
    "aliasEventName" TEXT NOT NULL,
    "aliasEventCategory" TEXT NOT NULL,
    "isBlacklisted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "activity_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "activity_aliases_keyEventName_keyEventCategory_key" ON "workflow"."activity_aliases"("eventName", "eventCategory");

-- CreateIndex
CREATE INDEX "activity_aliases_keyEventName_idx" ON "workflow"."activity_aliases"("eventName");

-- CreateIndex
CREATE INDEX "activity_aliases_keyEventCategory_idx" ON "workflow"."activity_aliases"("eventCategory");
