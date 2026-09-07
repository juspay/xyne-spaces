-- Move workflow_executions table from public schema to workflow schema.
-- All related tables (workflow_execution_states, workflow_execution_locks,
-- workflow_execution_users, workflow_steps) are already in the workflow schema.
-- relationMode = "prisma" means no FK constraints exist in the database,
-- so SET SCHEMA is safe — it moves the table and all its indexes atomically.

ALTER TABLE "public"."workflow_executions" SET SCHEMA "workflow";
