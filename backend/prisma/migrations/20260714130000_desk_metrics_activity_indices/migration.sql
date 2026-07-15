-- ticket_activities indices for desk metrics channel-scoped queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ticket_activities_channelId_timestamp_idx" ON "public"."ticket_activities" ("channelId", "timestamp");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ticket_activities_channelId_activityType_timestamp_idx" ON "public"."ticket_activities" ("channelId", "activityType", "timestamp");
