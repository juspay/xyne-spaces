-- experiment_runs.orgId → NOT NULL. Every run is created by the webhook with a
-- non-nullable agent.orgId (the only creator), so no null rows exist; this makes
-- the tenant key explicit for the workspace-id governance check. Children
-- (experiment_findings / experiment_reviews) inherit tenant scope via their
-- experimentId FK to experiment_runs and are annotated workspace-check:ignore.
ALTER TABLE "experiment_runs" ALTER COLUMN "orgId" SET NOT NULL;
