-- Digital Twin pipeline schema.
--
-- Adds three opt-in fields to users + a per-user candidate-memory table
-- that the user (not an admin) reviews before retain.
--
-- All pipeline work is gated on users.digitalTwinEnabled — when false,
-- nothing reads this user's Spaces data and nothing runs in the curator.

ALTER TABLE "users"
  ADD COLUMN "digitalTwinEnabled"       BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN "digitalTwinEnabledAt"     TIMESTAMP(3),
  ADD COLUMN "digitalTwinBackfillState" JSONB;

CREATE TABLE "user_memory_candidates" (
  "id"                TEXT         NOT NULL,
  "userId"            TEXT         NOT NULL,
  "subsystem"         TEXT         NOT NULL,
  "text"              TEXT         NOT NULL,
  "editedText"        TEXT,
  "sourceRefs"        JSONB        NOT NULL,
  "signalScore"       DOUBLE PRECISION NOT NULL,
  "status"            TEXT         NOT NULL DEFAULT 'pending',
  "hindsightMemoryId" TEXT,
  "source"            TEXT         NOT NULL,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  "approvedAt"        TIMESTAMP(3),
  "rejectedAt"        TIMESTAMP(3),

  CONSTRAINT "user_memory_candidates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "user_memory_candidates_userId_status_idx"
  ON "user_memory_candidates" ("userId", "status");

CREATE INDEX "user_memory_candidates_userId_subsystem_status_idx"
  ON "user_memory_candidates" ("userId", "subsystem", "status");

ALTER TABLE "user_memory_candidates"
  ADD CONSTRAINT "user_memory_candidates_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
