-- non_zero.call_recordings.recordingType (enum RecordingType)
ALTER TABLE "non_zero"."call_recordings" ALTER COLUMN "recordingType" TYPE text USING "recordingType"::text;

-- non_zero.call_recordings.status (enum RecordingStatus)
DROP INDEX IF EXISTS "non_zero"."call_recordings_one_active";
ALTER TABLE "non_zero"."call_recordings" ALTER COLUMN "status" TYPE text USING "status"::text;
CREATE UNIQUE INDEX IF NOT EXISTS "call_recordings_one_active" ON "non_zero"."call_recordings"("callId") WHERE "status" = 'RECORDING_ACTIVE';

-- non_zero.dynamic_dashboard_queries.queryType (enum QueryType, default internal)
ALTER TABLE "non_zero"."dynamic_dashboard_queries" ALTER COLUMN "queryType" DROP DEFAULT;
ALTER TABLE "non_zero"."dynamic_dashboard_queries" ALTER COLUMN "queryType" TYPE text USING "queryType"::text;
ALTER TABLE "non_zero"."dynamic_dashboard_queries" ALTER COLUMN "queryType" SET DEFAULT 'internal';

-- non_zero.dynamic_dashboard_queries.visualType (enum QueryVisualizationType)
ALTER TABLE "non_zero"."dynamic_dashboard_queries" ALTER COLUMN "visualType" TYPE text USING "visualType"::text;

-- public.boards.releaseTrackingMode (enum ReleaseTrackingMode)
ALTER TABLE "public"."boards" ALTER COLUMN "releaseTrackingMode" TYPE text USING "releaseTrackingMode"::text;

-- public.call_participants.meetingStatus (enum MeetingStatus, default PENDING)
ALTER TABLE "public"."call_participants" ALTER COLUMN "meetingStatus" DROP DEFAULT;
ALTER TABLE "public"."call_participants" ALTER COLUMN "meetingStatus" TYPE text USING "meetingStatus"::text;
ALTER TABLE "public"."call_participants" ALTER COLUMN "meetingStatus" SET DEFAULT 'PENDING';

-- public.channel_user_status.desktopNotificationLevel (enum NotificationLevel)
ALTER TABLE "public"."channel_user_status" ALTER COLUMN "desktopNotificationLevel" TYPE text USING "desktopNotificationLevel"::text;

-- public.channel_user_status.mobileNotificationLevel (enum NotificationLevel)
ALTER TABLE "public"."channel_user_status" ALTER COLUMN "mobileNotificationLevel" TYPE text USING "mobileNotificationLevel"::text;

-- public.lookup_values.type (enum LookupType)
ALTER TABLE "public"."lookup_values" ALTER COLUMN "type" TYPE text USING "type"::text;

-- public.messages.msgType (enum MessageType, default USER)
ALTER TABLE "public"."messages" ALTER COLUMN "msgType" DROP DEFAULT;
ALTER TABLE "public"."messages" ALTER COLUMN "msgType" TYPE text USING "msgType"::text;
ALTER TABLE "public"."messages" ALTER COLUMN "msgType" SET DEFAULT 'USER';

-- public.notification_preferences.notificationType (enum NotificationType)
ALTER TABLE "public"."notification_preferences" ALTER COLUMN "notificationType" TYPE text USING "notificationType"::text;

-- public.org_members.role (enum OrgRole)
ALTER TABLE "public"."org_members" ALTER COLUMN "role" TYPE text USING "role"::text;

-- public.proactive_nudges.type (enum NudgeType)
ALTER TABLE "public"."proactive_nudges" ALTER COLUMN "type" TYPE text USING "type"::text;

-- public.projects.type (enum ProjectType, default DEFAULT)
ALTER TABLE "public"."projects" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "public"."projects" ALTER COLUMN "type" TYPE text USING "type"::text;
ALTER TABLE "public"."projects" ALTER COLUMN "type" SET DEFAULT 'DEFAULT';

-- public.pull_requests.status (enum PRStatus)
ALTER TABLE "public"."pull_requests" ALTER COLUMN "status" TYPE text USING "status"::text;

-- public.queries.visualType (enum QueryVisualizationType)
ALTER TABLE "public"."queries" ALTER COLUMN "visualType" TYPE text USING "visualType"::text;

-- public.rcas.status (enum RCAStatus, default DRAFT)
ALTER TABLE "public"."rcas" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "public"."rcas" ALTER COLUMN "status" TYPE text USING "status"::text;
ALTER TABLE "public"."rcas" ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- public.recaps.entityType (enum RecapEntityType)
ALTER TABLE "public"."recaps" ALTER COLUMN "entityType" TYPE text USING "entityType"::text;

-- public.recurring_call_series.status (enum RecurringCallSeriesStatus, default ACTIVE)
ALTER TABLE "public"."recurring_call_series" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "public"."recurring_call_series" ALTER COLUMN "status" TYPE text USING "status"::text;
ALTER TABLE "public"."recurring_call_series" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

-- public.release_events.eventType (enum ReleaseEventType)
ALTER TABLE "public"."release_events" ALTER COLUMN "eventType" TYPE text USING "eventType"::text;

-- public.surface_nudges.nudgeKind (enum NudgeKind)
ALTER TABLE "public"."surface_nudges" ALTER COLUMN "nudgeKind" TYPE text USING "nudgeKind"::text;

-- public.surface_nudges.state (enum NudgeState, default ACTIVE)
ALTER TABLE "public"."surface_nudges" ALTER COLUMN "state" DROP DEFAULT;
ALTER TABLE "public"."surface_nudges" ALTER COLUMN "state" TYPE text USING "state"::text;
ALTER TABLE "public"."surface_nudges" ALTER COLUMN "state" SET DEFAULT 'ACTIVE';

-- public.user_groups.rotationInterval (enum RotationInterval)
ALTER TABLE "public"."user_groups" ALTER COLUMN "rotationInterval" TYPE text USING "rotationInterval"::text;

-- public.user_preferences.globalDesktopNotificationLevel (enum NotificationLevel)
ALTER TABLE "public"."user_preferences" ALTER COLUMN "globalDesktopNotificationLevel" TYPE text USING "globalDesktopNotificationLevel"::text;

-- public.user_preferences.globalMobileNotificationLevel (enum NotificationLevel)
ALTER TABLE "public"."user_preferences" ALTER COLUMN "globalMobileNotificationLevel" TYPE text USING "globalMobileNotificationLevel"::text;

-- workflow.external_messages.direction (enum MessageDirection)
ALTER TABLE "workflow"."external_messages" ALTER COLUMN "direction" TYPE text USING "direction"::text;

-- workflow.notifications.status (enum NotificationStatus, default UNREAD)
ALTER TABLE "workflow"."notifications" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "workflow"."notifications" ALTER COLUMN "status" TYPE text USING "status"::text;
ALTER TABLE "workflow"."notifications" ALTER COLUMN "status" SET DEFAULT 'UNREAD';

-- workflow.notifications.type (enum NotificationType)
ALTER TABLE "workflow"."notifications" ALTER COLUMN "type" TYPE text USING "type"::text;

-- workflow.user_activity_events.platform (enum Platform)
ALTER TABLE "workflow"."user_activity_events" ALTER COLUMN "platform" TYPE text USING "platform"::text;
