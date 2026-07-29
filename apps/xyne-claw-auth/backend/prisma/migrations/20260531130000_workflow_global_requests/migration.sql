-- "Push to global" approval queue. A workflow owner requests promotion; an
-- admin approves (sets agent_chain_workflows.global = true and rewires the
-- workflow's bindings to userId='*') or rejects.
CREATE TABLE "workflow_global_requests" (
    "id"                TEXT NOT NULL,
    "workflowId"        TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "status"            TEXT NOT NULL DEFAULT 'pending',
    "reviewedByUserId"  TEXT,
    "reviewedAt"        TIMESTAMP(3),
    "reviewNote"        TEXT,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,
    CONSTRAINT "workflow_global_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "workflow_global_requests_status_createdAt_idx"
    ON "workflow_global_requests" ("status", "createdAt");
CREATE INDEX "workflow_global_requests_workflowId_status_idx"
    ON "workflow_global_requests" ("workflowId", "status");

ALTER TABLE "workflow_global_requests"
    ADD CONSTRAINT "workflow_global_requests_workflowId_fkey"
    FOREIGN KEY ("workflowId") REFERENCES "agent_chain_workflows"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
