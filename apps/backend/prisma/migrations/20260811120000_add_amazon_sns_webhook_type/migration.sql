-- Adds the Amazon SNS incoming-webhook source type.
-- Postgres cannot use a newly added enum value in the same transaction that adds
-- it, so this ALTER TYPE is kept alone in its own migration.
ALTER TYPE "workflow"."AppIncomingWebhookType" ADD VALUE IF NOT EXISTS 'AMAZON_SNS';
