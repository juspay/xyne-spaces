-- non_zero.dashboard_participants.role (enum DashboardRole, default VIEWER)
ALTER TABLE "non_zero"."dashboard_participants" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "non_zero"."dashboard_participants" ALTER COLUMN "role" TYPE text USING "role"::text;
ALTER TABLE "non_zero"."dashboard_participants" ALTER COLUMN "role" SET DEFAULT 'VIEWER';

-- non_zero.dynamic_dashboard_queries.entityType (enum FormEntityType)
ALTER TABLE "non_zero"."dynamic_dashboard_queries" ALTER COLUMN "entityType" TYPE text USING "entityType"::text;

-- non_zero.dynamic_dashboards.visibility (enum DashboardVisibility, default PRIVATE)
ALTER TABLE "non_zero"."dynamic_dashboards" ALTER COLUMN "visibility" DROP DEFAULT;
ALTER TABLE "non_zero"."dynamic_dashboards" ALTER COLUMN "visibility" TYPE text USING "visibility"::text;
ALTER TABLE "non_zero"."dynamic_dashboards" ALTER COLUMN "visibility" SET DEFAULT 'PRIVATE';

-- public.app_commands.commandAccessibility (enum CommandAccessibility)
ALTER TABLE "public"."app_commands" ALTER COLUMN "commandAccessibility" TYPE text USING "commandAccessibility"::text;

-- public.app_commands.commandType (enum CommandType)
ALTER TABLE "public"."app_commands" ALTER COLUMN "commandType" TYPE text USING "commandType"::text;

-- public.call_participants.response (enum InvitationResponse)
ALTER TABLE "public"."call_participants" ALTER COLUMN "response" TYPE text USING "response"::text;

-- public.canvases.docType (enum DocType, default Canvas)
ALTER TABLE "public"."canvases" ALTER COLUMN "docType" DROP DEFAULT;
ALTER TABLE "public"."canvases" ALTER COLUMN "docType" TYPE text USING "docType"::text;
ALTER TABLE "public"."canvases" ALTER COLUMN "docType" SET DEFAULT 'Canvas';

-- public.channel_participants.role (enum ChannelRole, default MEMBER)
ALTER TABLE "public"."channel_participants" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "public"."channel_participants" ALTER COLUMN "role" TYPE text USING "role"::text;
ALTER TABLE "public"."channel_participants" ALTER COLUMN "role" SET DEFAULT 'MEMBER';

-- public.channel_sections.sortOrder (enum ChannelSortOrder)
ALTER TABLE "public"."channel_sections" ALTER COLUMN "sortOrder" TYPE text USING "sortOrder"::text;

-- public.channel_stats.addUserPolicy (enum ChannelAddUserPolicy, default EVERYONE)
ALTER TABLE "public"."channel_stats" ALTER COLUMN "addUserPolicy" DROP DEFAULT;
ALTER TABLE "public"."channel_stats" ALTER COLUMN "addUserPolicy" TYPE text USING "addUserPolicy"::text;
ALTER TABLE "public"."channel_stats" ALTER COLUMN "addUserPolicy" SET DEFAULT 'EVERYONE';

-- public.channels.addUserPolicy (enum ChannelAddUserPolicy, default EVERYONE)
ALTER TABLE "public"."channels" ALTER COLUMN "addUserPolicy" DROP DEFAULT;
ALTER TABLE "public"."channels" ALTER COLUMN "addUserPolicy" TYPE text USING "addUserPolicy"::text;
ALTER TABLE "public"."channels" ALTER COLUMN "addUserPolicy" SET DEFAULT 'EVERYONE';

-- public.channels.scopeType (enum ChannelScopeType)
ALTER TABLE "public"."channels" ALTER COLUMN "scopeType" TYPE text USING "scopeType"::text;

-- public.channels.type (enum ChannelType, default DEFAULT)
ALTER TABLE "public"."channels" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "public"."channels" ALTER COLUMN "type" TYPE text USING "type"::text;
ALTER TABLE "public"."channels" ALTER COLUMN "type" SET DEFAULT 'DEFAULT';

-- public.channels.visibility (enum ChannelVisibility, default PUBLIC)
ALTER TABLE "public"."channels" ALTER COLUMN "visibility" DROP DEFAULT;
ALTER TABLE "public"."channels" ALTER COLUMN "visibility" TYPE text USING "visibility"::text;
ALTER TABLE "public"."channels" ALTER COLUMN "visibility" SET DEFAULT 'PUBLIC';

-- public.collection_items.ingestionStatus (enum IngestionStatus, default NONE)
ALTER TABLE "public"."collection_items" ALTER COLUMN "ingestionStatus" DROP DEFAULT;
ALTER TABLE "public"."collection_items" ALTER COLUMN "ingestionStatus" TYPE text USING "ingestionStatus"::text;
ALTER TABLE "public"."collection_items" ALTER COLUMN "ingestionStatus" SET DEFAULT 'NONE';

-- public.collection_permissions.role (enum CollectionRole)
ALTER TABLE "public"."collection_permissions" ALTER COLUMN "role" TYPE text USING "role"::text;

-- public.conversation_participants.participationType (enum ConversationParticipation)
ALTER TABLE "public"."conversation_participants" ALTER COLUMN "participationType" TYPE text USING "participationType"::text;

-- public.delayed_messages.status (enum DelayedMessageStatus, default PENDING)
ALTER TABLE "public"."delayed_messages" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "public"."delayed_messages" ALTER COLUMN "status" TYPE text USING "status"::text;
ALTER TABLE "public"."delayed_messages" ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- public.email_channel_preferences.deskType (enum DeskType, default EMAIL)
ALTER TABLE "public"."email_channel_preferences" ALTER COLUMN "deskType" DROP DEFAULT;
ALTER TABLE "public"."email_channel_preferences" ALTER COLUMN "deskType" TYPE text USING "deskType"::text;
ALTER TABLE "public"."email_channel_preferences" ALTER COLUMN "deskType" SET DEFAULT 'EMAIL';

-- public.email_channel_preferences.emailMergeMode (enum EmailMergeMode, default ENABLED)
ALTER TABLE "public"."email_channel_preferences" ALTER COLUMN "emailMergeMode" DROP DEFAULT;
ALTER TABLE "public"."email_channel_preferences" ALTER COLUMN "emailMergeMode" TYPE text USING "emailMergeMode"::text;
ALTER TABLE "public"."email_channel_preferences" ALTER COLUMN "emailMergeMode" SET DEFAULT 'ENABLED';

-- public.emails.type (enum EmailType)
ALTER TABLE "public"."emails" ALTER COLUMN "type" TYPE text USING "type"::text;

-- public.form_fields.fieldType (enum FormFieldType)
ALTER TABLE "public"."form_fields" ALTER COLUMN "fieldType" TYPE text USING "fieldType"::text;

-- public.forms.contextType (enum FormContextType)
ALTER TABLE "public"."forms" ALTER COLUMN "contextType" TYPE text USING "contextType"::text;

-- public.forms.entityType (enum FormEntityType)
ALTER TABLE "public"."forms" ALTER COLUMN "entityType" TYPE text USING "entityType"::text;

-- public.forms_context_mapping.contextType (enum FormContextType)
ALTER TABLE "public"."forms_context_mapping" ALTER COLUMN "contextType" TYPE text USING "contextType"::text;

-- public.forms_context_mapping.entityType (enum FormEntityType)
ALTER TABLE "public"."forms_context_mapping" ALTER COLUMN "entityType" TYPE text USING "entityType"::text;

-- public.global_fields.fieldType (enum FormFieldType)
ALTER TABLE "public"."global_fields" ALTER COLUMN "fieldType" TYPE text USING "fieldType"::text;

-- public.installed_app_commands.commandAccessibility (enum CommandAccessibility)
ALTER TABLE "public"."installed_app_commands" ALTER COLUMN "commandAccessibility" TYPE text USING "commandAccessibility"::text;

-- public.installed_app_commands.commandType (enum CommandType)
ALTER TABLE "public"."installed_app_commands" ALTER COLUMN "commandType" TYPE text USING "commandType"::text;

-- public.links.visibility (enum LinkVisibility, default DEFAULT)
ALTER TABLE "public"."links" ALTER COLUMN "visibility" DROP DEFAULT;
ALTER TABLE "public"."links" ALTER COLUMN "visibility" TYPE text USING "visibility"::text;
ALTER TABLE "public"."links" ALTER COLUMN "visibility" SET DEFAULT 'DEFAULT';

-- public.queries.entityType (enum FormEntityType)
ALTER TABLE "public"."queries" ALTER COLUMN "entityType" TYPE text USING "entityType"::text;

-- public.user_preferences.channelSortOrder (enum ChannelSortOrder, default RECENCY)
ALTER TABLE "public"."user_preferences" ALTER COLUMN "channelSortOrder" DROP DEFAULT;
ALTER TABLE "public"."user_preferences" ALTER COLUMN "channelSortOrder" TYPE text USING "channelSortOrder"::text;
ALTER TABLE "public"."user_preferences" ALTER COLUMN "channelSortOrder" SET DEFAULT 'RECENCY';

-- workflow.external_messages.entityType (enum ExternalEntityType, default MESSAGE)
ALTER TABLE "workflow"."external_messages" ALTER COLUMN "entityType" DROP DEFAULT;
ALTER TABLE "workflow"."external_messages" ALTER COLUMN "entityType" TYPE text USING "entityType"::text;
ALTER TABLE "workflow"."external_messages" ALTER COLUMN "entityType" SET DEFAULT 'MESSAGE';
