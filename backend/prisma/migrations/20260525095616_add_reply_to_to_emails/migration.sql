-- Add replyTo column to emails table for storing Reply-To header addresses.
-- This enables correct recipient resolution for list-relayed emails
-- (e.g. "Name via Group <group@domain.com>" where the actual sender is in Reply-To).
ALTER TABLE "emails" ADD COLUMN IF NOT EXISTS "replyTo" TEXT[] NOT NULL DEFAULT '{}';
