-- Add mode column to workflow_executions table
-- Mode can be 'automatic' (default) or 'manual' for agent step continuation control

-- Create the enum type first
CREATE TYPE "public"."WorkflowExecutionMode" AS ENUM ('AUTOMATIC', 'MANUAL');

-- Add the column with default value 'automatic' (in public schema)
ALTER TABLE "public"."workflow_executions"
ADD COLUMN IF NOT EXISTS "mode" "public"."WorkflowExecutionMode" NOT NULL DEFAULT 'AUTOMATIC';

-- Create index for faster lookups by mode
CREATE INDEX IF NOT EXISTS "workflow_executions_mode_idx" ON "public"."workflow_executions"("mode");


-- AlterEnum
ALTER TYPE "AttachmentEntityType" ADD VALUE 'WORKFLOW_STEPS';
