-- Mark the people a HEADLESS (note-taker) recording is *about* on the existing
-- `call_participants` row instead of in a table of their own.
--
-- `calls.recordingParticipants` (stringified JSON string[]) stays the source of
-- truth. These rows are a derived index, so the Oats recording lists can filter
-- by participant with an indexed equality instead of
-- `recordingParticipants LIKE '%"<id>"%'`, which is a full scan on the Zero
-- replica and can never be covered by an already-synced query.
--
-- Safe to co-locate with real membership because the two never meet on one row:
-- recording participants exist only on HEADLESS calls (every write path is gated
-- on callType), and HEADLESS calls never get invitee rows.

-- Drop the earlier standalone table if an environment picked it up from a
-- `prisma db push` of the superseded schema. Never carried data of its own.
DROP TABLE IF EXISTS "public"."call_recording_participants";

-- AlterTable
ALTER TABLE "public"."call_participants"
    ADD COLUMN "isRecordingParticipant" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "call_participants_userId_isRecordingParticipant_callId_idx"
    ON "public"."call_participants"("userId", "isRecordingParticipant", "callId");

-- Backfill from the existing JSON column.
--
-- `recordingParticipants` is only ever written by JSON.stringify(string[]), but
-- the column is plain TEXT, so a bad historical value would abort the whole
-- migration on a hard ::jsonb cast. This temporary helper degrades a malformed
-- or non-array value to an empty array instead.
CREATE FUNCTION pg_temp.safe_json_string_array(raw TEXT)
RETURNS jsonb AS $$
DECLARE
    parsed jsonb;
BEGIN
    parsed := raw::jsonb;
    IF jsonb_typeof(parsed) <> 'array' THEN
        RETURN '[]'::jsonb;
    END IF;
    RETURN parsed;
EXCEPTION WHEN others THEN
    RETURN '[]'::jsonb;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

INSERT INTO "public"."call_participants"
    ("id", "workspaceId", "callId", "userId", "invitedBy", "invitedAt",
     "meetingStatus", "isExternal", "isRecordingParticipant")
SELECT
    gen_random_uuid()::text,
    c."workspaceId",
    c."id",
    participant.value,
    c."createdByUserId",   -- the creator curates this list
    c."createdAt",
    'PENDING',
    false,
    true
FROM "public"."calls" c
CROSS JOIN LATERAL jsonb_array_elements_text(
    pg_temp.safe_json_string_array(c."recordingParticipants")
) AS participant(value)
WHERE c."callType" = 'HEADLESS'
  AND participant.value <> ''
ON CONFLICT ("callId", "userId") DO UPDATE
    SET "isRecordingParticipant" = true;

-- Creator invariant: every HEADLESS call carries a flagged row for its creator,
-- whether or not the JSON column lists them.
--
-- The app has always treated the creator as one of a recording's people — the
-- client prepends them unconditionally when reading the JSON (see
-- getRecordingParticipantIds). Encoding that here rather than re-deriving it in
-- every query lets the participant filter be a single indexed EXISTS instead of
-- an OR across two tables, which the planner cannot drive from an index.
--
-- Consequence to be aware of: these rows are the *effective* participant set
-- (JSON ∪ {creator}), not a byte-for-byte mirror of the JSON column.
INSERT INTO "public"."call_participants"
    ("id", "workspaceId", "callId", "userId", "invitedBy", "invitedAt",
     "meetingStatus", "isExternal", "isRecordingParticipant")
SELECT
    gen_random_uuid()::text,
    c."workspaceId",
    c."id",
    c."createdByUserId",
    c."createdByUserId",
    c."createdAt",
    'PENDING',
    false,
    true
FROM "public"."calls" c
WHERE c."callType" = 'HEADLESS'
  AND c."createdByUserId" <> ''
ON CONFLICT ("callId", "userId") DO UPDATE
    SET "isRecordingParticipant" = true;
