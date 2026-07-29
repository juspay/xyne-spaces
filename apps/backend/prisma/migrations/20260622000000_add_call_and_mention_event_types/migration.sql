-- Add CALL_EVENT type for call automation triggers 
ALTER TYPE "public"."WorkflowEventType" ADD VALUE IF NOT EXISTS 'CALL_EVENT';