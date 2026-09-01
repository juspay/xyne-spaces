-- Drop the old unique constraint that was missing contextType.
-- Without contextType, desk_metrics and desk_ticket views for the same channel
-- could not share a name even though they are independent features.
DROP INDEX IF EXISTS "public"."saved_user_configurations_userId_contextId_name_key";

-- Add the correct constraint scoped to (userId, contextType, contextId, name).
-- This allows the same name across different context types (e.g. DESK_METRICS vs DESK_TICKET)
-- while still preventing duplicate names within the same feature + channel.
CREATE UNIQUE INDEX "saved_user_configurations_userId_contextType_contextId_name_key"
  ON "public"."saved_user_configurations"("userId", "contextType", "contextId", "name");
