-- Per-experiment LLM pin (providerOverride on epoch dispatch).
ALTER TABLE "experiment_runs" ADD COLUMN "provider" TEXT;
ALTER TABLE "experiment_runs" ADD COLUMN "modelId" TEXT;
