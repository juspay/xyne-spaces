-- Add agent profile-picture (avatar) support at the agent level so it exists in
-- ALL lifecycle states, including DRAFT (before a Spaces app / bot user exists).
-- Stores a GCS object key; NULL means fall back to the color-initials badge.
ALTER TABLE "agents" ADD COLUMN "avatarKey" TEXT;
