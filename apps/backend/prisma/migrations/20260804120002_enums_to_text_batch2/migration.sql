-- public.activities.classification (enum ActivityClassification, default PENDING)
ALTER TABLE "public"."activities" ALTER COLUMN "classification" DROP DEFAULT;
ALTER TABLE "public"."activities" ALTER COLUMN "classification" TYPE text USING "classification"::text;
ALTER TABLE "public"."activities" ALTER COLUMN "classification" SET DEFAULT 'PENDING';

-- public.activities.classificationJobType (enum ActivityClassificationJobType)
ALTER TABLE "public"."activities" ALTER COLUMN "classificationJobType" TYPE text USING "classificationJobType"::text;

-- public.available_app_permissions.type (enum AppPermissionType)
ALTER TABLE "public"."available_app_permissions" ALTER COLUMN "type" TYPE text USING "type"::text;

-- public.boards.boardType (enum BoardType, default DEFAULT)
ALTER TABLE "public"."boards" ALTER COLUMN "boardType" DROP DEFAULT;
ALTER TABLE "public"."boards" ALTER COLUMN "boardType" TYPE text USING "boardType"::text;
ALTER TABLE "public"."boards" ALTER COLUMN "boardType" SET DEFAULT 'DEFAULT';

-- public.bookmarks.entityType (enum BookmarkEntityType)
ALTER TABLE "public"."bookmarks" ALTER COLUMN "entityType" TYPE text USING "entityType"::text;

-- public.calls.callOrigin (enum CallOrigin, default CHANNEL)
ALTER TABLE "public"."calls" ALTER COLUMN "callOrigin" DROP DEFAULT;
ALTER TABLE "public"."calls" ALTER COLUMN "callOrigin" TYPE text USING "callOrigin"::text;
ALTER TABLE "public"."calls" ALTER COLUMN "callOrigin" SET DEFAULT 'CHANNEL';

-- public.calls.callType (enum CallType, default VIDEO)
ALTER TABLE "public"."calls" ALTER COLUMN "callType" DROP DEFAULT;
ALTER TABLE "public"."calls" ALTER COLUMN "callType" TYPE text USING "callType"::text;
ALTER TABLE "public"."calls" ALTER COLUMN "callType" SET DEFAULT 'VIDEO';

-- public.calls.status (enum CallStatus, default ACTIVE)
ALTER TABLE "public"."calls" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "public"."calls" ALTER COLUMN "status" TYPE text USING "status"::text;
ALTER TABLE "public"."calls" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

-- public.canvas_participants.role (enum CanvasRole, default VIEWER)
ALTER TABLE "public"."canvas_participants" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "public"."canvas_participants" ALTER COLUMN "role" TYPE text USING "role"::text;
ALTER TABLE "public"."canvas_participants" ALTER COLUMN "role" SET DEFAULT 'VIEWER';

-- public.canvases.visibility (enum CanvasVisibility, default PRIVATE)
ALTER TABLE "public"."canvases" ALTER COLUMN "visibility" DROP DEFAULT;
ALTER TABLE "public"."canvases" ALTER COLUMN "visibility" TYPE text USING "visibility"::text;
ALTER TABLE "public"."canvases" ALTER COLUMN "visibility" SET DEFAULT 'PRIVATE';

-- public.coes.status (enum COEStatus, default OPEN)
ALTER TABLE "public"."coes" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "public"."coes" ALTER COLUMN "status" TYPE text USING "status"::text;
ALTER TABLE "public"."coes" ALTER COLUMN "status" SET DEFAULT 'OPEN';

-- public.email_channel_preferences.autoDraftMode (enum AutoDraftMode, default OFF)
ALTER TABLE "public"."email_channel_preferences" ALTER COLUMN "autoDraftMode" DROP DEFAULT;
ALTER TABLE "public"."email_channel_preferences" ALTER COLUMN "autoDraftMode" TYPE text USING "autoDraftMode"::text;
ALTER TABLE "public"."email_channel_preferences" ALTER COLUMN "autoDraftMode" SET DEFAULT 'OFF';

-- public.email_drafts.autoDraftStatus (enum AutoDraftStatus)
ALTER TABLE "public"."email_drafts" ALTER COLUMN "autoDraftStatus" TYPE text USING "autoDraftStatus"::text;

-- public.installed_app_permissions.status (enum AppPermissionStatus, default UNAPPROVED)
ALTER TABLE "public"."installed_app_permissions" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "public"."installed_app_permissions" ALTER COLUMN "status" TYPE text USING "status"::text;
ALTER TABLE "public"."installed_app_permissions" ALTER COLUMN "status" SET DEFAULT 'UNAPPROVED';

-- public.message_attachments.entityType (enum AttachmentEntityType)
ALTER TABLE "public"."message_attachments" ALTER COLUMN "entityType" TYPE text USING "entityType"::text;

-- public.message_attachments.uploadStatus (enum AttachmentUploadStatus)
ALTER TABLE "public"."message_attachments" ALTER COLUMN "uploadStatus" TYPE text USING "uploadStatus"::text;

-- public.release_attributions.confidence (enum AttributionConfidence, default LOW)
ALTER TABLE "public"."release_attributions" ALTER COLUMN "confidence" DROP DEFAULT;
ALTER TABLE "public"."release_attributions" ALTER COLUMN "confidence" TYPE text USING "confidence"::text;
ALTER TABLE "public"."release_attributions" ALTER COLUMN "confidence" SET DEFAULT 'LOW';

-- public.resource_access.accessType (enum AccessType)
ALTER TABLE "public"."resource_access" ALTER COLUMN "accessType" TYPE text USING "accessType"::text;

-- public.users.authProvider (enum AuthProvider, default GOOGLE)
ALTER TABLE "public"."users" ALTER COLUMN "authProvider" DROP DEFAULT;
ALTER TABLE "public"."users" ALTER COLUMN "authProvider" TYPE text USING "authProvider"::text;
ALTER TABLE "public"."users" ALTER COLUMN "authProvider" SET DEFAULT 'GOOGLE';

-- public.users.calendarVisibility (enum CalendarVisibility, default PUBLIC)
ALTER TABLE "public"."users" ALTER COLUMN "calendarVisibility" DROP DEFAULT;
ALTER TABLE "public"."users" ALTER COLUMN "calendarVisibility" TYPE text USING "calendarVisibility"::text;
ALTER TABLE "public"."users" ALTER COLUMN "calendarVisibility" SET DEFAULT 'PUBLIC';

-- workflow.acl_audit_logs.eventType (enum ACLAuditEventType)
ALTER TABLE "workflow"."acl_audit_logs" ALTER COLUMN "eventType" TYPE text USING "eventType"::text;

-- workflow.acl_audit_logs.targetType (enum ACLAuditTargetType)
ALTER TABLE "workflow"."acl_audit_logs" ALTER COLUMN "targetType" TYPE text USING "targetType"::text;

-- workflow.app_incoming_webhooks.action (enum AppIncomingWebhookAction, default MESSAGE)
ALTER TABLE "workflow"."app_incoming_webhooks" ALTER COLUMN "action" DROP DEFAULT;
ALTER TABLE "workflow"."app_incoming_webhooks" ALTER COLUMN "action" TYPE text USING "action"::text;
ALTER TABLE "workflow"."app_incoming_webhooks" ALTER COLUMN "action" SET DEFAULT 'MESSAGE';

-- workflow.app_incoming_webhooks.type (enum AppIncomingWebhookType, default SLACK)
ALTER TABLE "workflow"."app_incoming_webhooks" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "workflow"."app_incoming_webhooks" ALTER COLUMN "type" TYPE text USING "type"::text;
ALTER TABLE "workflow"."app_incoming_webhooks" ALTER COLUMN "type" SET DEFAULT 'SLACK';
