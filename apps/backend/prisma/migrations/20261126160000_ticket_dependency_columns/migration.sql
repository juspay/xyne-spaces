-- Expand-only. Existing mappings retain NULL/default semantics; no data rewrite.
ALTER TABLE "public"."ticket_reference_mappings"
  ADD COLUMN "strength" TEXT,
  ADD COLUMN "gatedStageId" TEXT,
  ADD COLUMN "satisfiedStageId" TEXT,
  ADD COLUMN "origin" TEXT,
  ADD COLUMN "satisfiedAt" TIMESTAMP(3),
  ADD COLUMN "reviewNeededAt" TIMESTAMP(3),
  ADD COLUMN "overriddenAt" TIMESTAMP(3),
  ADD COLUMN "overriddenBy" TEXT,
  ADD COLUMN "overrideReason" TEXT;

ALTER TABLE "public"."ticket_sub_ticket_mappings"
  ADD COLUMN "strength" TEXT,
  ADD COLUMN "gatedStageId" TEXT,
  ADD COLUMN "satisfiedAt" TIMESTAMP(3),
  ADD COLUMN "overriddenAt" TIMESTAMP(3),
  ADD COLUMN "overriddenBy" TEXT,
  ADD COLUMN "overrideReason" TEXT;

CREATE INDEX "ticket_reference_mappings_targetTicketId_relationType_idx"
  ON "public"."ticket_reference_mappings"("targetTicketId", "relationType");
CREATE INDEX "ticket_reference_mappings_sourceTicketId_relationType_idx"
  ON "public"."ticket_reference_mappings"("sourceTicketId", "relationType");
