/**
 * The error-pipeline bucket taxonomy + grounded routing rules — 4 working lanes
 * + default (consolidated 11 → 6 → 4 on 2026-07-02/03 to cap concurrent
 * fix-agents at 4: one agent per stream, so lanes = max parallel agents).
 *
 * Source of truth for the matchers: the 10-agent grounded scan of backend/src
 * error-log sites (2026-07-01) + two live tuning passes on real prod traffic
 * (2026-07-02), re-grounded against the REAL 3-day error distribution pulled from
 * VictoriaLogs on 2026-07-03 (23k errors, 84 families — every keyword below earns
 * its place by observed traffic).
 *
 * Matching is `keywords` (literal phrases — auto-escaped, case-INSENSITIVE
 * substring) unioned with `markers` (advanced raw regex, case-SENSITIVE). Most
 * routing is plain service tags / phrases, so those live in keywords (editable
 * as chips in admin); only genuine patterns (\w*, \b, .*, char classes, groups)
 * stay in markers.
 *
 * Applied via POST /claw/api/v1/admin/error-pipeline/seed (CLAW_ADMIN) —
 * idempotent upsert by name. NOTE: re-seeding overwrites keywords/markers/
 * matchOrder/description edited later via admin — the table is the live source
 * of truth, this file is the factory reset.
 */

export interface ErrorBucketSeed {
  name: string;
  description: string;
  matchOrder: number;
  keywords?: string[]; // friendly literal phrases (auto-escaped, case-insensitive)
  markers?: string;    // advanced raw regex, unioned with keywords
}

export const ERROR_BUCKET_SEED: ErrorBucketSeed[] = [
  {
    name: "integrations",
    description: "external services: Bitbucket/GitHub/Jira/Confluence/Google/Microsoft/Zoho connectors + outbound Slack/email/push/FCM/APNS sends",
    matchOrder: 3,
    keywords: [
      "[Bitbucket-Webhook]", "[GitHub-Webhook]", "[Bitbucket-API]", "[Bitbucket API]", "[GithubManager]",
      "[BitbucketManager]", "[getGitProvider]", "[PR-Ticket-Sync]", "[PR-Validation]", "[PR-Check-Approval]",
      "[CommitAnalysisService]", "[AutoStub]", "[ReleaseChanges]", "[ZohoService]", "[jira-migration]",
      "[ConfluenceImport]", "[ConfluenceMigration]", "[confluence-migration]", "[GoogleAuth]", "[GoogleRefetch]",
      "[GoogleFlow]", "[SuperpositionClient]", "[CALENDAR_SYNC]", "[Jira-Compat]",
      "[NOTIFICATION-SERVICE]", "[NotificationService]", "[MobilePush]", "[FCM]", "[FCM:local]", "[AutoDraft]",
      "[BOOKMARK-REMINDER]", "[SCHEDULED-MESSAGE-SERVICE]", "[GoogleEmailService]", "[EmailService]", "[approval-notifications]",
      "Slack chat.postMessage failed", "Slack API error", "Slack API returned", "Mobile push delivery failed",
      "An API error occurred", "[GoogleService]", "invalid_grant", "Failed to setup Gmail watch",
      "FCM push", "FCM delivery", "FCM payload", "FCM access token", "FCM service account",
    ],
    markers:
      "\\[(ZohoFlow\\.\\w+|JiraMigration\\w*|Mettle[\\w ]*|Microsoft\\w*)\\]|(Bitbucket|GitHub|Jira|Confluence|Mettle) (GraphQL )?(API |request )?(error|returned|request failed|failed \\(\\d+\\))|\\bAPNS\\b|Failed to send (message to Slack|Slack (message|mention|thread reply|canvas mention|DM)|.*notification)",
  },
  {
    name: "conversations",
    description: "messaging & sync: messages, channels, canvas, docs, Vespa search, Y-Sweet + websockets, zero-sync, presence, typing",
    matchOrder: 1,
    keywords: [
      "[ConversationService]", "[CanvasService]", "[DocsService]", "[Xyne-Comment]", "[ChannelService]",
      "[schemaHandler]", "[VR]", "[MESSAGE-COUNT]",
      "ErrorPerformingSearch", "ErrorInsertingDocument", "ErrorRetrievingDocuments", "ErrorDeletingDocuments",
      "Error queuing Vespa job", "Error pushing Vespa job", "Failed to fetch link preview for", "File upload failed",
      "Invalid channel IDs", "Y-Sweet", "YSweet",
      "canvasParticipant", "canvasId", "Failed to auto-create canvas", "getClientToken",
      "messageSearch", "notification.create", "[BOT-MENTION]",
      "Failed to search document", "Failed to insert document", "Failed to update document", "Failed to delete document", "Failed to fetch document",
      "[USER-STATUS]", "[PRESENCE]", "[PRESENCE-BACKFILL]", "[TYPING]", "[TYPING-BROADCAST]", "[TYPING-DEBUG]",
      "[JOIN-SESSION]", "[ADD-SUB]", "[REMOVE-SUB]", "[BULK-SUB]", "[USER-EVENT]", "[USER-EVENTS]", "[REDIS-MSG]",
      "[NOTIFICATION-ACK]", "[NOTIFICATION-UPDATE]", "[EDGE]", "[ZERO-FALLBACK]", "[WORKSPACE-PUB]", "[WORKSPACE-REDIS]",
      "[WORKSPACE-CACHE]", "[WORKFLOW-SUB]", "[WORKFLOW-UNSUB]", "[WORKFLOW-CLEANUP]", "[USER-COUNT]",
      "PushProcessor", "zero_mutation_error", "zero_query_error",
      "WebSocket authentication", "WebSocket auth error", "WebSocket server not initialized",
    ],
    markers: "\\[(VESPA[_-]\\w*)\\]|[Vv]espa\\w*",
  },
  {
    name: "product",
    description: "tickets/desk/boards/nudges/forms + calls/recordings/transcripts/LiveKit + AI features (summarisers, ticket-AI, recaps, LLM calls)",
    matchOrder: 2,
    keywords: [
      "[AppDeskService]", "[SlackDeskService]", "[MicrosoftDeskService]", "[DeskIntegration]", "[TicketService]",
      "[TicketTagDualWrite]", "[TicketCleanupWorker]", "[FULL-ROLE-ASSIGN]", "[AUTO-ASSIGN]", "[KanbanCountsService]",
      "[NudgeEngine]", "[NudgeService]", "[SurfaceLinkService]", "[ActivityContextResolver]", "[TicketController]",
      "[TicketBot]", "[TicketTool]", "[GetMyTickets]",
      "Duplicate ticket analysis failed", "Board suggestion analysis failed", "DL member sync", "Cannot delete form fields",
      "Microsoft createReply", "Microsoft send draft", "Microsoft sendMail", "Microsoft attachment add", "Microsoft draft cleanup",
      "[CallRecording]", "[CALL-COUNT]", "[CALL-DURATION]", "[CallDocumentService]", "[TranscriptService]", "[TranscriptReady]",
      "[Pulse]", "[VoiceInputService]", "[MeetLinkService]", "[SESSION-RECORDING-SYNC]", "[GOOGLE_CALENDAR_STORE]",
      "[MICROSOFT_CALENDAR_STORE]", "[LiveKit]", "[LiveKit Webhook]", "[CallController]", "[call-lobby]",
      "[call-chat]", "[CallValidationWorker]",
      "livekit_room_creation_failed", "access_token_generation_failed", "recording_permanently_dropped",
      "Failed to auto-end call", "process_call_with_summary_failed", "Failed to start egress", "Failed to stop egress",
      "prd_generation_failed", "detailed_summary_generation_failed",
      "[AskAI]", "[Summariser]", "[TitleGenerator]", "[DescriptionGenerator]", "[TicketDuplicate]",
      "[TicketBoard]", "[ReleaseNotes]", "[DashboardAI]", "[ClawAgentService]", "[ResearchAgentService]",
      "[AiContextService]", "[ContextFetcher]", "[SummarizationService]", "[ConversationAnalysisService]",
      "[DocumentAnalysisService]", "[Classification]", "[PriorityClassification]", "[Memory]", "[ProjectRecap]",
      "[Recap]", "[ReleaseNotesService]", "[ReleaseReport]", "[PERSONALIZATION]", "[SudoQuery]", "[Tool]",
      "[SessionStore]", "[TicketDescriptionCleaner]", "[FieldDiscovery]", "[FVD]", "[SystemSkills]",
      "litellm", "Langfuse", "LLM call failed", "LLM run failed", "Failed to parse agent output",
    ],
    markers:
      "\\[(TEAM-INTEL-[A-Z-]+|TeamIntelligence\\w*)\\]|\\[TAG\\]\\[(PIPELINE|CTRL)\\]|Parent ticket .* not found|Ticket nudge .* failed|\\[GCAL_\\w+\\]|(post_)?transcript(_processing|_parsing|_download)?_failed|\\[(XyneAI\\w*|ProductInsights\\w*|Single(Cluster|Meta)ThemeAnalyzer)\\]|No JSON( payload)? found in .*(agent|analysis) response|generation failed:\\s*\\S*_tag",
  },
  {
    name: "platform",
    description: "platform & data layer: JWT/sessions/OAuth/ACL + workers/queues/cron + Prisma/Postgres/Redis + GCS/S3/uploads/attachments",
    matchOrder: 4,
    keywords: [
      "[AUTH]", "[OAuth]", "[REGENERATE-JWT]", "[SAM Auth]", "[Mettle User Sync Auth]", "[SlackUserAuth]",
      "[CanvasAuth]", "[CanvasAuthService]", "[requirePermission]", "[requireAnyPermission]", "[requireAllPermissions]",
      "[grantPermissionsForRole]", "[Webhook ACL]",
      "permission denied", "Authorization failed", "Authorization error",
      "[OPENCODE-EXECUTOR]", "[AGENT-EXECUTOR]", "[OpenCode]", "[OpenCodeClient]", "[DB-STORAGE]", "[WorkflowStorage]",
      "[getExecutionGitInfo]", "[GitDiff]", "[WORKER_SCHEDULER]", "[EventPoller]", "[automations]", "[AUTOMATION-SERVICE]",
      "[BULL_WORKER]", "[VESPA_WORKER]", "[AUTO-DRAFT-QUEUE]", "[CONV-INGEST-QUEUE]", "[ETA-DEADLINE]", "[PRESENCE-CLEANUP]",
      "[ON-CALL-ROTATION]", "[SLACK-MIGRATION-QUEUE]", "[SLACK-MIGRATION-WORKER]",
      "WorkflowStep not found", "not found in registry", "No workflow found", "No workflow execution",
      "Failed to compute git diff", "Failed to parse git diff",
      "[REDIS]", "[QueryEngine]", "[QueryCache]", "[PR-Repository]",
      "Unique constraint", "Foreign key constraint", "Record to update", "Record to delete", "Lua script failed",
      "Redis not initialized", "Redis connection error", "Redis publisher not initialized", "Redis subscriber not initialized",
      "[GCS_POLLING]", "[GCS-SYNC]", "[WORKFLOW-STEP-GCS-SYNC]", "[GCSServiceFactory]", "[StorageServiceFactory]",
      "[DoclingService]", "[DoclingStrategy]", "[FileProcessor]", "[BaseStrategy]", "[ExternalAttachmentService]",
      "[BaseGcsAdapter]", "[UPLOAD-STREAM]",
      "Signed URL generation failed", "File buffer is empty", "Thumbnail", "gs://", "attachments/",
      "[LIST-STORAGE-ARTIFACTS]", "The specified bucket does not exist", "File does not exist in GCS",
    ],
    markers:
      "\\b(JWT|token)\\b.*(expired|invalid|verif|decod|refresh|sign)|Failed to (create|get|revoke|update) (user )?session|(API key|apiKey).*(expired|invalid|not found)|\\bACL\\b.*(denied|not found)|(PKCE|state).*(not found|expired)|Job \\S*job\\.(id|name)\\S* failed|Failed to schedule .* with cron|Bot (job|execution).*failed|\\bP1\\d{3}\\b|\\bP2\\d{3}\\b|PrismaClient\\w*Error|Invalid `?prisma\\.\\w+\\.\\w+|\\bDatabase (error|warning|health check)\\b|\\[(REDIS-[A-Z-]+|SearchRepository\\.\\w+)\\]|\\bGCS\\b|\\bS3\\b",
  },
  {
    name: "default",
    description: "no rule matched — add a keyword in admin to route these",
    matchOrder: 25,
  },
];
