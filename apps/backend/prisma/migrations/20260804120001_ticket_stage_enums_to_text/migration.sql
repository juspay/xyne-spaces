-- public.board_sla_policies.priority (enum TicketPriority)
ALTER TABLE "public"."board_sla_policies" ALTER COLUMN "priority" TYPE text USING "priority"::text;

-- public.stage_approvers.approverType (enum ApproverType)
ALTER TABLE "public"."stage_approvers" ALTER COLUMN "approverType" TYPE text USING "approverType"::text;

-- public.stage_pr_status_mappings.prStatus (enum PRStatusEvent)
ALTER TABLE "public"."stage_pr_status_mappings" ALTER COLUMN "prStatus" TYPE text USING "prStatus"::text;

-- public.stage_transitions.onReenter (enum ReenterMode)
ALTER TABLE "public"."stage_transitions" ALTER COLUMN "onReenter" TYPE text USING "onReenter"::text;

-- public.stage_transitions.visitSlaMode (enum VisitSlaMode)
ALTER TABLE "public"."stage_transitions" ALTER COLUMN "visitSlaMode" TYPE text USING "visitSlaMode"::text;

-- public.stages.defaultTicketStatus (enum TicketStatus, default IN_PROGRESS)
ALTER TABLE "public"."stages" ALTER COLUMN "defaultTicketStatus" DROP DEFAULT;
ALTER TABLE "public"."stages" ALTER COLUMN "defaultTicketStatus" TYPE text USING "defaultTicketStatus"::text;
ALTER TABLE "public"."stages" ALTER COLUMN "defaultTicketStatus" SET DEFAULT 'IN_PROGRESS';

-- public.stages.defaultTicketStatusV2 (enum TicketStatusV2, default STARTED)
ALTER TABLE "public"."stages" ALTER COLUMN "defaultTicketStatusV2" DROP DEFAULT;
ALTER TABLE "public"."stages" ALTER COLUMN "defaultTicketStatusV2" TYPE text USING "defaultTicketStatusV2"::text;
ALTER TABLE "public"."stages" ALTER COLUMN "defaultTicketStatusV2" SET DEFAULT 'STARTED';

-- public.ticket_activities.activityType (enum ActivityType)
ALTER TABLE "public"."ticket_activities" ALTER COLUMN "activityType" TYPE text USING "activityType"::text;

-- public.ticket_assignments.userResponsibility (enum UserResponsibility)
ALTER TABLE "public"."ticket_assignments" ALTER COLUMN "userResponsibility" TYPE text USING "userResponsibility"::text;

-- public.ticket_entity_mappings.entityType (enum EntityType)
ALTER TABLE "public"."ticket_entity_mappings" ALTER COLUMN "entityType" TYPE text USING "entityType"::text;

-- public.ticket_reference_mappings.relationType (enum TicketReferenceRelation)
ALTER TABLE "public"."ticket_reference_mappings" ALTER COLUMN "relationType" TYPE text USING "relationType"::text;

-- public.ticket_stage_requests.status (enum TicketStageRequestStatus, default DRAFT)
ALTER TABLE "public"."ticket_stage_requests" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "public"."ticket_stage_requests" ALTER COLUMN "status" TYPE text USING "status"::text;
ALTER TABLE "public"."ticket_stage_requests" ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- public.ticket_user_mailbox.state (enum MailboxState)
ALTER TABLE "public"."ticket_user_mailbox" ALTER COLUMN "state" TYPE text USING "state"::text;

-- public.tickets.priority (enum TicketPriority, default LOW)
ALTER TABLE "public"."tickets" ALTER COLUMN "priority" DROP DEFAULT;
ALTER TABLE "public"."tickets" ALTER COLUMN "priority" TYPE text USING "priority"::text;
ALTER TABLE "public"."tickets" ALTER COLUMN "priority" SET DEFAULT 'LOW';

-- public.tickets.status (enum TicketStatus, default NEW)
ALTER TABLE "public"."tickets" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "public"."tickets" ALTER COLUMN "status" TYPE text USING "status"::text;
ALTER TABLE "public"."tickets" ALTER COLUMN "status" SET DEFAULT 'NEW';

-- public.tickets.statusV2 (enum TicketStatusV2, default TODO)
ALTER TABLE "public"."tickets" ALTER COLUMN "statusV2" DROP DEFAULT;
ALTER TABLE "public"."tickets" ALTER COLUMN "statusV2" TYPE text USING "statusV2"::text;
ALTER TABLE "public"."tickets" ALTER COLUMN "statusV2" SET DEFAULT 'TODO';

-- public.user_group_mappings.responsibility (enum UserResponsibility)
ALTER TABLE "public"."user_group_mappings" ALTER COLUMN "responsibility" TYPE text USING "responsibility"::text;
