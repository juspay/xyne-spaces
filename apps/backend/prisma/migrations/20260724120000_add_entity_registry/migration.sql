-- CreateTable — Prisma model: Entity (@@map "entities", @@schema "non_zero").
-- Entity registry for mention extraction: one row per real-world thing; every
-- spelling of it resolves here. Server-write-only, not synced via Zero.
CREATE TABLE "non_zero"."entities" (
    "workspaceId" TEXT,
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "canonicalName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "mentionCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable — Prisma model: EntityAlias (@@map "entity_aliases", @@schema "non_zero").
-- Surface forms (spellings) of an entity; the resolver matches mentions against
-- these — exact on normalizedForm, fuzzy via pg_trgm. Not synced via Zero.
CREATE TABLE "non_zero"."entity_aliases" (
    "workspaceId" TEXT,
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "surfaceForm" TEXT NOT NULL,
    "normalizedForm" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entity_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "entities_workspaceId_type_idx" ON "non_zero"."entities"("workspaceId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "entities_workspaceId_type_normalizedName_key" ON "non_zero"."entities"("workspaceId", "type", "normalizedName");

-- CreateIndex
CREATE INDEX "entity_aliases_entityId_idx" ON "non_zero"."entity_aliases"("entityId");

-- CreateIndex
CREATE UNIQUE INDEX "entity_aliases_workspaceId_type_normalizedForm_key" ON "non_zero"."entity_aliases"("workspaceId", "type", "normalizedForm");

-- Fuzzy resolution engine: pg_trgm + a GIN trigram index on the normalized form,
-- which the resolver queries with `normalizedForm % 'query'` / similarity().
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "entity_aliases_normalizedForm_trgm_idx"
    ON "non_zero"."entity_aliases" USING gin ("normalizedForm" gin_trgm_ops);
