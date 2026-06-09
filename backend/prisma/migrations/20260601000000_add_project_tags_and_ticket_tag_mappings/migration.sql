-- Project-level tags: one row per unique tag name per project.
-- Replaces the flat ticket_tags table which stored tag names per ticket
-- causing expensive full-table scans during hydration.
CREATE TABLE "public"."project_tags" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_tags_pkey" PRIMARY KEY ("id")
);

-- Mapping table: links tickets to their project-level tags.
-- tagName is denormalized from project_tags.name for fast reads (tags are never renamed).
CREATE TABLE "public"."ticket_tag_mappings" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "tagName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_tag_mappings_pkey" PRIMARY KEY ("id")
);

-- Unique constraint: same tag name can't appear twice in the same project
CREATE UNIQUE INDEX "project_tags_projectId_name_key" ON "public"."project_tags"("projectId", "name");

-- Unique constraint: a ticket can't have the same tag assigned twice
CREATE UNIQUE INDEX "ticket_tag_mappings_ticketId_tagId_key" ON "public"."ticket_tag_mappings"("ticketId", "tagId");

-- Performance indexes
CREATE INDEX "project_tags_projectId_idx" ON "public"."project_tags"("projectId");
CREATE INDEX "ticket_tag_mappings_ticketId_idx" ON "public"."ticket_tag_mappings"("ticketId");
CREATE INDEX "ticket_tag_mappings_tagId_idx" ON "public"."ticket_tag_mappings"("tagId");
