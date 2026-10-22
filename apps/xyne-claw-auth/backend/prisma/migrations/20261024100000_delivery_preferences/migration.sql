-- Per-user, per-org choice of where agent messages reach the person (Spaces,
-- WhatsApp, Teams, in their order). A JSON list instead of a Postgres enum so
-- a surface that is not live yet can be stored without a type migration. No
-- row means the person never chose, and every flow keeps its old routing.
CREATE TABLE "delivery_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "order" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "delivery_preferences_userId_orgId_key" ON "delivery_preferences"("userId", "orgId");

-- AddForeignKey
ALTER TABLE "delivery_preferences" ADD CONSTRAINT "delivery_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
