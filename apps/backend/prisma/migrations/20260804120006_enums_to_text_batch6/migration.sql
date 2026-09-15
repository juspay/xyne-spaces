-- Telepresence columns intentionally omitted: the telepresence feature (models and its
-- creating migration) was reverted on main, so those tables are not guaranteed to exist.
-- ALTERing them would fail on any database where they were never created.

-- public.recurring_call_participants.meetingStatus (enum MeetingStatus, default PENDING)
ALTER TABLE "public"."recurring_call_participants" ALTER COLUMN "meetingStatus" DROP DEFAULT;
ALTER TABLE "public"."recurring_call_participants" ALTER COLUMN "meetingStatus" TYPE text USING "meetingStatus"::text;
ALTER TABLE "public"."recurring_call_participants" ALTER COLUMN "meetingStatus" SET DEFAULT 'PENDING';

-- public.recurring_call_participants.response (enum InvitationResponse)
ALTER TABLE "public"."recurring_call_participants" ALTER COLUMN "response" TYPE text USING "response"::text;
