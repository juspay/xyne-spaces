-- non_zero.tags.method (enum TagMethod)
ALTER TABLE "non_zero"."tags" ALTER COLUMN "method" TYPE text USING "method"::text;

-- non_zero.team_intelligence_ingestion_batches_v2.status (enum TeamIntelligenceBatchStatus, default RECEIVED)
ALTER TABLE "non_zero"."team_intelligence_ingestion_batches_v2" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "non_zero"."team_intelligence_ingestion_batches_v2" ALTER COLUMN "status" TYPE text USING "status"::text;
ALTER TABLE "non_zero"."team_intelligence_ingestion_batches_v2" ALTER COLUMN "status" SET DEFAULT 'RECEIVED';

-- non_zero.team_intelligence_org_summaries_v2.status (enum TeamIntelligenceBatchStatus, default RECEIVED)
ALTER TABLE "non_zero"."team_intelligence_org_summaries_v2" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "non_zero"."team_intelligence_org_summaries_v2" ALTER COLUMN "status" TYPE text USING "status"::text;
ALTER TABLE "non_zero"."team_intelligence_org_summaries_v2" ALTER COLUMN "status" SET DEFAULT 'RECEIVED';

-- non_zero.team_intelligence_team_summaries_v2.status (enum TeamIntelligenceBatchStatus, default RECEIVED)
ALTER TABLE "non_zero"."team_intelligence_team_summaries_v2" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "non_zero"."team_intelligence_team_summaries_v2" ALTER COLUMN "status" TYPE text USING "status"::text;
ALTER TABLE "non_zero"."team_intelligence_team_summaries_v2" ALTER COLUMN "status" SET DEFAULT 'RECEIVED';

-- non_zero.team_intelligence_user_ingestions_v2.processingStatus (enum TeamIntelligenceUserIngestionStatus, default RECEIVED)
ALTER TABLE "non_zero"."team_intelligence_user_ingestions_v2" ALTER COLUMN "processingStatus" DROP DEFAULT;
ALTER TABLE "non_zero"."team_intelligence_user_ingestions_v2" ALTER COLUMN "processingStatus" TYPE text USING "processingStatus"::text;
ALTER TABLE "non_zero"."team_intelligence_user_ingestions_v2" ALTER COLUMN "processingStatus" SET DEFAULT 'RECEIVED';

-- public.boards.vcsProvider (enum VCSProviderType)
ALTER TABLE "public"."boards" ALTER COLUMN "vcsProvider" TYPE text USING "vcsProvider"::text;

-- public.invitations.role (enum WorkspaceRole, default MEMBER)
ALTER TABLE "public"."invitations" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "public"."invitations" ALTER COLUMN "role" TYPE text USING "role"::text;
ALTER TABLE "public"."invitations" ALTER COLUMN "role" SET DEFAULT 'MEMBER';

-- public.organizations.status (enum Status, default ACTIVE)
ALTER TABLE "public"."organizations" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "public"."organizations" ALTER COLUMN "status" TYPE text USING "status"::text;
ALTER TABLE "public"."organizations" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

-- public.rcas.severity (enum SEVERITY)
ALTER TABLE "public"."rcas" ALTER COLUMN "severity" TYPE text USING "severity"::text;

-- public.saved_user_configuration_values.entityName (enum SavedConfigEntityName)
ALTER TABLE "public"."saved_user_configuration_values" ALTER COLUMN "entityName" TYPE text USING "entityName"::text;

-- public.saved_user_configurations.contextType (enum SavedConfigContextType)
ALTER TABLE "public"."saved_user_configurations" ALTER COLUMN "contextType" TYPE text USING "contextType"::text;

-- public.saved_user_configurations.visibility (enum SavedConfigVisibility)
ALTER TABLE "public"."saved_user_configurations" ALTER COLUMN "visibility" TYPE text USING "visibility"::text;

-- public.surface_links.linkKind (enum SurfaceLinkKind)
ALTER TABLE "public"."surface_links" ALTER COLUMN "linkKind" TYPE text USING "linkKind"::text;

-- public.surface_links.sourceType (enum SurfaceAreaType)
ALTER TABLE "public"."surface_links" ALTER COLUMN "sourceType" TYPE text USING "sourceType"::text;

-- public.surface_links.targetType (enum SurfaceAreaType)
ALTER TABLE "public"."surface_links" ALTER COLUMN "targetType" TYPE text USING "targetType"::text;

-- public.user_presence.status (enum UserPresenceStatus, default OFFLINE)
ALTER TABLE "public"."user_presence" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "public"."user_presence" ALTER COLUMN "status" TYPE text USING "status"::text;
ALTER TABLE "public"."user_presence" ALTER COLUMN "status" SET DEFAULT 'OFFLINE';

-- public.users.role (enum WorkspaceRole, default MEMBER)
ALTER TABLE "public"."users" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "public"."users" ALTER COLUMN "role" TYPE text USING "role"::text;
ALTER TABLE "public"."users" ALTER COLUMN "role" SET DEFAULT 'MEMBER';

-- public.users.status (enum UserStatus, default ACTIVE)
ALTER TABLE "public"."users" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "public"."users" ALTER COLUMN "status" TYPE text USING "status"::text;
ALTER TABLE "public"."users" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

-- public.users.userType (enum UserType, default USER)
ALTER TABLE "public"."users" ALTER COLUMN "userType" DROP DEFAULT;
ALTER TABLE "public"."users" ALTER COLUMN "userType" TYPE text USING "userType"::text;
ALTER TABLE "public"."users" ALTER COLUMN "userType" SET DEFAULT 'USER';

-- public.workflow_executions.mode (enum WorkflowExecutionMode, default AUTOMATIC)
ALTER TABLE "public"."workflow_executions" ALTER COLUMN "mode" DROP DEFAULT;
ALTER TABLE "public"."workflow_executions" ALTER COLUMN "mode" TYPE text USING "mode"::text;
ALTER TABLE "public"."workflow_executions" ALTER COLUMN "mode" SET DEFAULT 'AUTOMATIC';

-- public.workflows.eventType (enum WorkflowEventType, default NO_OP)
ALTER TABLE "public"."workflows" ALTER COLUMN "eventType" DROP DEFAULT;
ALTER TABLE "public"."workflows" ALTER COLUMN "eventType" TYPE text USING "eventType"::text;
ALTER TABLE "public"."workflows" ALTER COLUMN "eventType" SET DEFAULT 'NO_OP';

-- public.workspace_organizations.role (enum WorkspaceRole)
ALTER TABLE "public"."workspace_organizations" ALTER COLUMN "role" TYPE text USING "role"::text;

-- public.workspaces.status (enum Status, default ACTIVE)
ALTER TABLE "public"."workspaces" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "public"."workspaces" ALTER COLUMN "status" TYPE text USING "status"::text;
ALTER TABLE "public"."workspaces" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

-- workflow.notifications.deliveryMethods (enum NotificationDeliveryMethod)
ALTER TABLE "workflow"."notifications" ALTER COLUMN "deliveryMethods" TYPE text[] USING "deliveryMethods"::text[];

-- workflow.session_recording_files.status (enum SessionRecordingProcessStatus, default PENDING)
ALTER TABLE "workflow"."session_recording_files" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "workflow"."session_recording_files" ALTER COLUMN "status" TYPE text USING "status"::text;
ALTER TABLE "workflow"."session_recording_files" ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- workflow.user_sessions.status (enum SessionStatus, default ACTIVE)
ALTER TABLE "workflow"."user_sessions" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "workflow"."user_sessions" ALTER COLUMN "status" TYPE text USING "status"::text;
ALTER TABLE "workflow"."user_sessions" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

-- workflow.vespa_insertion_logs.status (enum VespaInsertionStatus, default PENDING)
ALTER TABLE "workflow"."vespa_insertion_logs" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "workflow"."vespa_insertion_logs" ALTER COLUMN "status" TYPE text USING "status"::text;
ALTER TABLE "workflow"."vespa_insertion_logs" ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- workflow.vespa_insertion_logs.type (enum VespaOperationType)
ALTER TABLE "workflow"."vespa_insertion_logs" ALTER COLUMN "type" TYPE text USING "type"::text;

-- workflow.workflow_mappings.entityType (enum WorkflowMappingEntityType)
ALTER TABLE "workflow"."workflow_mappings" ALTER COLUMN "entityType" TYPE text USING "entityType"::text;
