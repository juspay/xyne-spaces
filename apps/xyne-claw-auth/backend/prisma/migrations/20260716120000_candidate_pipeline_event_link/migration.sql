-- Link a retained memory back to the pipeline event that proposed it, so the
-- Digital Twin memories list can deep-link to the LLM reasoning ("View
-- reasoning"). Nullable + additive: existing candidates (created before this
-- link existed) keep pipelineEventId = NULL and render a "No trace" state.
ALTER TABLE "user_memory_candidates" ADD COLUMN "pipelineEventId" TEXT;

-- The memories list joins candidates by hindsightMemoryId to surface the link;
-- index it so that lookup stays cheap as the shared twin bank grows.
CREATE INDEX "user_memory_candidates_hindsightMemoryId_idx"
  ON "user_memory_candidates" ("hindsightMemoryId");
