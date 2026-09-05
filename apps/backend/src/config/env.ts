import dotenv from 'dotenv';
import Joi from 'joi';

dotenv.config();

import { parseInternalAppHostMap } from '@/utils/internalHostMap';

const envSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  SANDBOX_TEST_MODE: Joi.boolean().default(false),
  ORG_MEMBER_LIMIT: Joi.number().integer().min(1).allow(null).default(null),
  RESEARCH_AGENT_URL: Joi.string().default('http://localhost:8000'),
  // Python transcription agent (health server also exposes /embed-voice)
  PYTHON_AGENT_URL: Joi.string().default('http://localhost:8080'),
  NX_GRAPH_SERVER_URL: Joi.string().default('http://localhost:8001'),
  NX_GRAPH_SERVER_URLS: Joi.string().default(''),
  RESEARCH_AGENT_API_KEY: Joi.string().default(''),
  USE_MOCK_ANALYSIS: Joi.boolean().default(false),
  USE_MOCK_BUILD: Joi.boolean().default(false),
  PORT: Joi.number().default(3001),

  // This is for making the backend API available under a prefix path (e.g. /api/v1) for reverse proxy setups. Empty string means no prefix.
  API_PATH_PREFIX: Joi.string().allow('').default(''),
  HOST: Joi.string().default('localhost'),
  CORS_ORIGIN: Joi.string().default('http://localhost:3000'),
  ALLOWED_MEDIA_ORIGINS: Joi.string().default(
    'http://localhost:5173/,xyne-spaces://./,xyne-spaces-dev://./,xyne-spaces-sandbox://./'
  ),
  RATE_LIMIT_WINDOW_MS: Joi.number().default(900000),
  RATE_LIMIT_MAX_REQUESTS: Joi.number().default(100),
  LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'debug').default('info'),
  // Streams error-level logs to Fluent Bit's forward input (see docker/fluent-bit/).
  // Off by default so envs without a Fluent Bit endpoint (e.g. prod, until one
  // is provisioned there) don't try to connect anywhere.
  LOG_FLUENT_ENABLED: Joi.boolean().default(false),
  LOG_FLUENT_HOST: Joi.string().default('localhost'),
  LOG_FLUENT_PORT: Joi.number().default(24224),
  LOG_USER_SESSION_CHANGES: Joi.boolean().default(true),
  DATABASE_URL: Joi.string().required(),
  DATABASE_READ_REPLICA_POOL_URL: Joi.string().optional().default(''),
  // Common DB (separate instance for cross-cutting shared state, e.g. entity sequences)
  COMMON_DATABASE_URL: Joi.string().allow('').default(''),
  COMMON_DATABASE_POOL_SIZE: Joi.number().default(2),
  COMMON_DATABASE_POOL_TIMEOUT_SECONDS: Joi.number().default(10),
  ENABLE_COMMON_DB_TICKET_SEQUENCE: Joi.boolean().default(false),
  WORKFLOW_LOCK_DURATION_MS: Joi.number().default(3600000), // 30 minutes in milliseconds
  API_KEYS_ENABLED: Joi.boolean().default(false),
  API_KEYS_CONFIG: Joi.string().default('{}'),
  // Digital Twin: the email of the Digital Twin app's bot user (unique per
  // workspace). USER_MENTIONED is delivered to THIS app at workspace scope (in
  // addition to the existing channel-scoped app delivery) so the twin fires for
  // @mentions in any channel it isn't a member of. Empty string disables the
  // extra twin delivery. Prod: digital-twin@app.xyne.ai.
  DIGITAL_TWIN_APP_EMAIL: Joi.string().allow('').default(''),
  GOOGLE_CLIENT_ID: Joi.string().allow('').default(''),
  GOOGLE_CLIENT_SECRET: Joi.string().allow('').default(''),
  // Email sender configuration (Google OAuth2 via nodemailer)
  GOOGLE_REFRESH_TOKEN: Joi.string().allow('').default(''),
  // Alternative Google OAuth app (isNy flow)
  GOOGLE_CLIENT_ID_NEW: Joi.string().allow('').default(''),
  GOOGLE_CLIENT_SECRET_NEW: Joi.string().allow('').default(''),
  GOOGLE_REFRESH_TOKEN_NEW: Joi.string().allow('').default(''),
  EMAIL_FROM: Joi.string().allow('').default(''),
  EMAIL_FROM_NAME: Joi.string().allow('').default('Xyne Spaces'),
  COMMUNITY_JOIN_APPROVED_EMAIL_MESSAGE: Joi.string()
    .allow('')
    .default(
      'Your request to join {{workspaceName}} Community is approved.\\n\\nYou can login community now: {{joinLink}}\\n\\nExcited to have you onboard.'
    ),
  JWT_SECRET: Joi.string().required(),
  JWT_EXPIRATION_SECONDS: Joi.number().default(86400), // 24 hours in seconds
  FORCE_LOGOUT_BEFORE: Joi.number().optional(), // Unix timestamp (seconds) - reject tokens issued before this time
  SESSION_EXPIRY_DAYS: Joi.number().default(365), // Session cookie expiry in days (default 1 year)
  // File Storage Configuration
  STORAGE_PROVIDER: Joi.string().valid('gcs', 'local', 's3').default('gcs'),
  // AWS S3 Configuration
  AWS_REGION: Joi.string().default('ap-south-1'),
  AWS_ACCESS_KEY_ID: Joi.string().allow('').default(''),
  AWS_SECRET_ACCESS_KEY: Joi.string().allow('').default(''),
  S3_BUCKET_NAME: Joi.string().allow('').default(''),
  S3_ENDPOINT: Joi.string().allow('').default(''), // for MinIO/LocalStack in dev
  // Google Cloud Storage Configuration (Workload Identity)
  GCS_PROJECT_ID: Joi.string().allow('').default(''),
  GCS_BUCKET_NAME: Joi.string().allow('').default(''),
  MIGRATION_GCS_BUCKET: Joi.string().allow('').default(''),
  MIGRATION_ENC_KEYS: Joi.string().allow('').default('{}'),
  MIGRATION_ENC_ACTIVE: Joi.string().allow('').default(''),
  RUN_SLACK_MIGRATION_WORKERS: Joi.boolean().default(false),
  MIGRATION_SLACK_PAGE_DELAY_MS: Joi.number().default(250),       // pause between paged Slack calls during collection (SDK still honors Retry-After on 429)
  MIGRATION_SLACK_LIST_DELAY_MS: Joi.number().default(3000),      // pause between Tier-2 list pages (conversations.list/users.list ≈ 20/min) to stay under the limit
  MIGRATION_SLACK_FILE_TIMEOUT_MS: Joi.number().default(600000),  // per-attachment download timeout (~10 min: enough for Slack's 1GB max at ~3MB/s)
  MIGRATION_SLACK_REQUEST_TIMEOUT_MS: Joi.number().default(30000),// per Slack API request timeout (aborts hung pages)
  MIGRATION_SLACK_STALL_LIMIT_MS: Joi.number().default(600000),   // no forward progress despite a live heartbeat ⇒ wedged (10 min)
  MIGRATION_INGEST_MESSAGE_DELAY_MS: Joi.number().default(2),     // pause between messages at ingest (~500 msg/s cap)
  GCS_BUNDLE_BUCKET_NAME: Joi.string().allow('').default(''),
  GCS_CANVAS_BUCKET_NAME: Joi.string().allow('').default(''),
  GCS_DOCS_BUCKET_NAME: Joi.string().allow('').default(''),
  GCS_MAX_FILE_SIZE_MB: Joi.number().default(1024),
  FAKE_GCS_HOST: Joi.string().allow('').default('localhost:4443'),
  TRANSCRIPTION_BUCKET_NAME: Joi.string().allow('').default(''),
  GCS_WORKFLOW_STEPS_BUCKET_NAME: Joi.string().default(''),
  GCS_SESSION_RECORDING_BUCKET_NAME: Joi.string().default(''),
  GCS_WORKFLOW_VR_BUCKET_NAME: Joi.string().default(''),
  ENABLE_WORKFLOW_STEP_GCS_SYNC: Joi.boolean().default(false),
  ENABLE_CONVERSATION_INGESTION_QUEUE: Joi.boolean().default(false),
  ENABLE_CONVERSATION_INGESTION_WORKER: Joi.boolean().default(false),
  ENABLE_SCHEDULED_MESSAGE_WORKER: Joi.boolean().default(false),
  ENABLE_STAGE_ETA_DEADLINE_WORKER: Joi.boolean().default(false),
  ENABLE_ETA_DEADLINE_WORKER: Joi.boolean().default(false),
  ENABLE_AUTOMATION_WORKER: Joi.boolean().default(false),
  ENABLE_DELAYED_MESSAGE_WORKER: Joi.boolean().default(false),
  ENABLE_EMAIL_FETCH_WORKER: Joi.boolean().default(false),
  ENABLE_CALENDAR_SYNC_WORKER: Joi.boolean().default(false),

  DESK_TICKET_DEBUG: Joi.boolean().default(false),
  ENABLE_EMAIL_CLASSIFICATION_WORKER: Joi.boolean().default(false),
  // One switch for the whole feature, read by both processes: the API gates
  // its producer on it, the worker gates its drain loop on it. A separate
  // worker flag only bought states that are a no-op or actively bad (enqueuing
  // with nothing draining), and idling the worker alone is a replicas:0
  // decision, not a config one. Toggling loses nothing — watermarks persist,
  // so the next enqueue replays everything above them.
  ENABLE_RADAR_EXECUTION: Joi.boolean().default(false),
  RADAR_PARSER_MODEL: Joi.string().default('open-fast'),
  RADAR_EXECUTION_LITELLM_API_KEY: Joi.string().allow('').default(''),
  // Kept as a knob deliberately: this is the hard ceiling on how much text can
  // enter one parse, so it is the emergency brake on parser spend.
  RADAR_MAX_WINDOW_MESSAGES: Joi.number().integer().min(1).default(200),
  RADAR_EXECUTION_WORKER_CONCURRENCY: Joi.number().integer().min(1).default(3),
  RADAR_RUN_LOG_RETENTION_DAYS: Joi.number().integer().min(1).default(3),
  ENABLE_TEAM_INTELLIGENCE_WORKER: Joi.boolean().default(false),
  TEAM_INTELLIGENCE_USER_JOB_CONCURRENCY: Joi.number().integer().min(1).default(2),
  TEAM_INTELLIGENCE_TEAM_JOB_CONCURRENCY: Joi.number().integer().min(1).default(2),
  TEAM_INTELLIGENCE_ORG_JOB_CONCURRENCY: Joi.number().integer().min(1).default(1),
  ENABLE_TAG_GENERATION_PIPELINE: Joi.boolean().default(false),
  TAG_GENERATION_CONCURRENCY: Joi.number().integer().min(1).max(20).default(1),
  TAG_GENERATION_LLM_TIMEOUT_MS: Joi.number().integer().min(1000).default(120000),
  ENABLE_STITCH_WORKER: Joi.boolean().default(false),
  ENABLE_AI_PROVISIONING_WORKER: Joi.boolean().default(false),
  ENABLE_SDLC_WORKER: Joi.boolean().default(false),
  SDLC_GLOBAL_ACTIVE_LIMIT: Joi.number().integer().min(1).max(100).default(9),
  SDLC_REPO_ACTIVE_LIMIT: Joi.number().integer().min(1).max(100).default(3),
  SDLC_CAPACITY_WAIT_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1000)
    .default(24 * 60 * 60 * 1000),
  SDLC_CAPACITY_RETRY_DELAY_MS: Joi.number().integer().min(1000).default(30_000),
  SDLC_CLAW_RUN_TIMEOUT_MS: Joi.number()
    .integer()
    .min(60_000)
    .default(3 * 60 * 60 * 1000),
  ENABLE_USER_AI_PROVISIONING: Joi.boolean().default(false),
  XYNE_CLAW_AUTH_INTERNAL_URL: Joi.string().uri().allow('').default(''),
  AI_PROVISIONING_QUEUE_ATTEMPTS: Joi.number().integer().min(1).default(3),
  AI_PROVISIONING_QUEUE_BACKOFF_MS: Joi.number().integer().min(0).default(5000),
  AI_PROVISIONING_REQUEST_TIMEOUT_MS: Joi.number().integer().min(1000).default(30000),
  COMMUNITY_WORKSPACE_USER_BUDGET: Joi.number().integer().min(0).allow(null).default(null),
  ENTERPRISE_WORKSPACE_USER_BUDGET: Joi.number().integer().min(0).allow(null).default(null),
  LITELLM_MANAGEMENT_BASE_URL: Joi.string().uri().allow('').default(''),
  LITELLM_MANAGEMENT_ADMIN_KEY: Joi.string().allow('').default(''),
  LITELLM_CHANGED_BY: Joi.string().default('external-system:xyne-spaces-external'),
  ORG_DEFAULT_MODELS: Joi.string().allow('').default('kimi-latest,private-large'),
  BACKEND_URL: Joi.string().default('http://localhost:3001'),
  SLACK_BOT_TOKEN: Joi.string().allow('').default(''),
  SLACK_FRONTEND_URL: Joi.string().allow('').default('http://localhost:5173'),
  FRONTEND_URL: Joi.string().default('http://localhost:5173'),
  FOLLOW_HEADER_REDIRECTION: Joi.boolean().default(true),
  TRUSTED_ORIGINAL_HOST_DOMAINS: Joi.string().default(''),
  GOOGLE_AUTH_REDIRECT_URI: Joi.string().uri().allow('').default(''),
  MICROSOFT_AUTH_REDIRECT_URI: Joi.string().uri().allow('').default(''),
  EXTERNAL_CALL_INVITE_BASE_URL: Joi.string().default('http://localhost:5174/external'),
  SLACK_SIGNING_SECRET: Joi.string().allow('').default(''), // Slack signing secret for request verification
  SLACK_MIGRATION_APPROVALS: Joi.string().allow('').default(''), // Comma-separated list of approved Slack user IDs
  SLACK_IGNORED_BOT_IDS: Joi.string().allow('').default(''), // Comma-separated list of bot IDs to exclude from migration
  SLACK_MIGRATION_FINAL_MESSAGE: Joi.string().allow('').default(''), // Custom message appended to the final migration notification
  SLACK_MIGRATION_LOG_CHANNEL_ID: Joi.string().allow('').default(''), // Slack channel ID for migration progress/error logs (defaults to #slack-migration-update)
  SLACK_MIGRATION_CREATOR_EMAIL: Joi.string().email().allow('').default(''), // Service-account email used to create migrated Slack channels
  // Google Sheets — Nightly Slack Migration
  // Uses GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET (config.email). Only needs a refresh token with Sheets scope.
  // One-time setup: https://developers.google.com/oauthplayground → scope: https://www.googleapis.com/auth/spreadsheets
  MIGRATION_SHEETS_REFRESH_TOKEN: Joi.string().allow('').default(''), // OAuth2 refresh token with spreadsheets scope
  MIGRATION_SHEET_ID: Joi.string().allow('').default(''), // Google Spreadsheet ID
  ENABLE_SLACK_MIGRATION_WORKER: Joi.boolean().default(false), // Toggle nightly migration cron on/off
  // Per-workspace Slack bot config (JSON keyed by Xyne workspaceId). Falls back to flat vars if empty.
  MIGRATION_SLACK_BOT_CONFIGS: Joi.string().allow('').default('{}'),
  SLACK_MIGRATION_CONCURRENCY: Joi.number().integer().min(1).default(2), // Max channels processed in parallel
  SLACK_MIGRATION_SYNC_CRON: Joi.string().default('30 18 * * *'), // Nightly sync cron (default: 12 AM IST = 18:30 UTC)
  SLACK_MIGRATION_CLEANUP_CRON: Joi.string().default('30 1 * * *'), // Cleanup cron (default: 7 AM IST = 01:30 UTC)
  SLACK_MIGRATION_NOTIFICATIONS_ENABLED: Joi.boolean().default(true), // Enable/disable Slack postMessage notifications during migration
  SYNC_DM_CONCURRENCY: Joi.number().integer().min(1).default(3), // Max DMs/group-DMs migrated in parallel (/sync-dm)
  SYNC_DM_LOG_CHANNEL: Joi.string().allow('').default(''), // Default Slack channel for /sync-dm updates; per-workspace override via MIGRATION_SLACK_BOT_CONFIGS[].syncDmLogChannelId
  // Zoho Integration
  // SAM Service Configuration
  SAM_BASE_URL: Joi.string().uri().default(''),
  SAM_API_KEY: Joi.string().allow('').default(''),
  // LiveKit Configuration
  // The development key pair ships in LiveKit's own published sample config, so a
  // deployment that keeps it signs room tokens anyone can mint. Empty stays valid:
  // deployments without calls do not configure LiveKit at all.
  LIVEKIT_API_KEY: Joi.string().allow('').invalid('devkey').default('').messages({
    'any.invalid': 'LIVEKIT_API_KEY must not be the published development key',
  }),
  LIVEKIT_API_SECRET: Joi.string().allow('').invalid('devsecret').default('').messages({
    'any.invalid': 'LIVEKIT_API_SECRET must not be the published development secret',
  }),
  LIVEKIT_URL: Joi.string().default('ws://localhost:7880'),
  LIVEKIT_CLIENT_URL: Joi.string().default('http://localhost:7880'),
  LIVEKIT_SERVER_URL: Joi.string().default('ws://localhost:7880'),
  // Call Recording Configuration
  CALL_RECORDING_ENABLED: Joi.boolean().default(false),
  CALL_RECORDING_RETENTION_DAYS: Joi.number().integer().min(0).default(0).max(365),
  SCREEN_RECORDING_RETENTION_DAYS: Joi.number().integer().min(0).default(30),
  FCM_PROJECT_ID: Joi.string().allow('').default(''),
  FCM_SERVICE_ACCOUNT_BASE64: Joi.string().allow('').default(''),
  FCM_PROJECT_ID_NEW: Joi.string().allow('').default(''),
  FCM_SERVICE_ACCOUNT_BASE64_NEW: Joi.string().allow('').default(''),
  APNS_KEY_ID: Joi.string().allow('').default(''),
  APNS_TEAM_ID: Joi.string().allow('').default(''),
  APNS_BUNDLE_ID: Joi.string().allow('').default(''),
  APNS_P8_BASE64: Joi.string().allow('').default(''),
  // Y-Sweet Configuration
  Y_SWEET_URL: Joi.string().default('http://localhost:8080'),
  Y_SWEET_SERVER_TOKEN: Joi.string().allow('').default(''),
  // LiteLLM Configuration for AI Agents
  LITELLM_BASE_URL: Joi.string().default(''),
  LITELLM_API_KEY: Joi.string().allow('').default(''),
  ENABLE_ENTITY_EXTRACTION: Joi.boolean().default(true),
  ENTITY_EXTRACTION_MODEL: Joi.string().default('open-fast'),
  ENTITY_EXTRACTION_CONCURRENCY: Joi.number().default(2),
  // How long a thread's job sits delayed before it runs. This is the debounce
  // window: every message on the thread inside it collapses into one job, so a
  // busy thread costs one extraction per window, not one per message.
  ENTITY_EXTRACTION_DEBOUNCE_MS: Joi.number().default(15 * 60 * 1000),
  // Org-level framing prepended to the mention-extraction prompt, so the model
  // knows whose data it is reading. Fixes identity-relative errors like listing
  // the org itself as an external ORGANISATION, and sharpens ORG vs MERCHANT.
  ENTITY_EXTRACTION_ORG_CONTEXT: Joi.string()
    .allow('')
    .default(
      'The data belongs to Juspay, a payments orchestration company. Juspay routes and ' +
        'processes online transactions for its merchant clients across many payment gateways, ' +
        'payment methods, card networks and banks. MERCHANTS are Juspay customers who use it to ' +
        'accept payments. Payment gateways/PSPs, card networks, banks and regulators such as NPCI ' +
        'are external ecosystem entities. Juspay itself is the operator, NOT an external ' +
        'organisation — never classify Juspay (or its own products/teams) as ORGANISATION.'
    ),
  ASK_AI_LITELLM_API_KEY: Joi.string().allow('').default(''),
  // Document outline generation (BaseStrategy.buildDocumentOutline) — an extra LLM
  // call per ingested document. Disable independently of the shared LiteLLM config.
  DOCUMENT_OUTLINE_ENABLED: Joi.boolean().default(true),
  IMAGE_GENERATION_ENDPOINT: Joi.string().default(''),
  IMAGE_GENERATION_MODEL: Joi.string().default(''),
  ACTIVITY_CLASSIFICATION_LITELLM_API_KEY: Joi.string().allow('').default(''),
  // Dedicated LiteLLM key for thread-type classification; falls back to the org's when unset.
  THREAD_TYPE_CLASSIFICATION_LITELLM_API_KEY: Joi.string().allow('').default(''),
  // LiteLLM config specifically for call features (transcript summary, PRD, detailed summary)
  CALL_LITELLM_API_KEY: Joi.string().allow('').default(''),
  CALL_LITELLM_MODEL: Joi.string().default(''),
  // Per-user "fast" / "thinking" model tiers for recording summary generation.
  // Same CALL_LITELLM_API_KEY for both; both fall back to CALL_LITELLM_MODEL.
  CALL_RECORDING_FAST_LITELLM_MODEL: Joi.string().allow('').default(''),
  CALL_RECORDING_THINKING_LITELLM_MODEL: Joi.string().allow('').default(''),
  ACTIVITY_CLASSIFICATION_MODEL: Joi.string().default(''),
  PRODUCT_INSIGHTS_RECLUSTER_CRON: Joi.string().default('0 2 * * *'),
  PRODUCT_INSIGHTS_RECLUSTER_WINDOW_DAYS: Joi.number().default(30),
  // Working Hours Configuration (in IST)
  WORKING_HOUR_START: Joi.number().default(11),
  WORKING_HOUR_END: Joi.number().default(19),
  ENABLE_NOTIFICATION_WORKER: Joi.boolean().default(false),
  ENABLE_MESSAGE_CLASSIFICATION: Joi.boolean().default(false),
  // What the dedicated classification key serves.
  MESSAGE_CLASSIFIER_MODEL: Joi.string().default('open-fast'),
  ENABLE_TICKET_CLEANUP_WORKER: Joi.boolean().default(false),
  ENABLE_WORKER_SCHEDULER: Joi.boolean().default(true),

  // @xyne/workflow-sdk
  ENABLE_WORKFLOWS_WORKER: Joi.boolean().default(false),
  WORKFLOWS_WORKER_CONCURRENCY: Joi.number().integer().min(1).default(3),
  WORKFLOWS_LOCK_DURATION_MS: Joi.number().integer().min(60_000).default(15 * 60 * 1000),
  WORKFLOWS_BASE_URL: Joi.string().allow('').default(''),
  ENABLE_RECAP_SCHEDULER: Joi.boolean().default(true),
  RECAP_GENERATION_CRON: Joi.string().default('15 0 * * *'), //5:45 IST daily
  RECAP_CLEANUP_CRON: Joi.string().default('30 23 * * *'), //5:00 IST daily
  RECAP_RETENTION_DAYS: Joi.number().default(30),
  ENABLE_DESK_REPORT_SCHEDULER: Joi.boolean().default(true),
  DESK_REPORT_GENERATION_CRON: Joi.string().default('30 22 * * *'), //4:00 IST daily
  DESK_REPORT_CLEANUP_CRON: Joi.string().default('30 21 * * *'), //3:00 IST daily
  DESK_REPORT_RETENTION_DAYS: Joi.number().default(3),
  RECENT_VISITED_LOOKBACK_DAYS: Joi.number().integer().min(1).default(7),
  ACTIVITY_CLASSIFICATION_MAX_RETRIES: Joi.number().default(2),
  TICKET_DESC_CLEAN_MODEL: Joi.string().default(''),
  TICKET_DESC_CLEAN_MAX_RETRIES: Joi.number().default(3),
  LLM_REQUEST_TIMEOUT_MS: Joi.number().default(120000),
  TEAM_INTELLIGENCE_LLM_MODEL: Joi.string().default('open-fast'),
  TEAM_INTELLIGENCE_LLM_REQUEST_TIMEOUT_MS: Joi.number().default(120000),
  TEAM_INTELLIGENCE_LLM_GLOBAL_CONCURRENCY: Joi.number().integer().min(1).default(8),
  TEAM_INTELLIGENCE_SECTION_CONCURRENCY: Joi.string().allow('').default(''),
  TEAM_INTELLIGENCE_USER_SECTION_CONCURRENCY: Joi.string().allow('').default(''),
  TEAM_INTELLIGENCE_TEAM_SECTION_CONCURRENCY: Joi.string().allow('').default(''),
  TEAM_INTELLIGENCE_ORG_SECTION_CONCURRENCY: Joi.string().allow('').default(''),
  // Dynamic Dashboard tunables
  DASHBOARD_AI_SSE_PING_INTERVAL_MS: Joi.number().default(20000),
  DASHBOARD_AI_TOP_VALUES_INLINE_LIMIT: Joi.number().default(30),
  DASHBOARD_QUERY_CACHE_TTL_SEC: Joi.number().default(60),
  DASHBOARD_QUERY_CACHE_MAX_VALUE_BYTES: Joi.number().default(2 * 1024 * 1024),
  DASHBOARD_PG_STATEMENT_TIMEOUT_MS: Joi.number().default(60000),
  DASHBOARD_PG_CONNECTION_TIMEOUT_MS: Joi.number().default(10000),
  DASHBOARD_CH_REQUEST_TIMEOUT_MS: Joi.number().default(65000),
  LANGFUSE_SECRET_KEY: Joi.string().allow('').default(''),
  LANGFUSE_PUBLIC_KEY: Joi.string().allow('').default(''),
  LANGFUSE_BASE_URL: Joi.string().allow('').default(''),
  MESSAGE_CLASSIFIER_URL: Joi.string().uri().default('http://localhost:8082'),
  MESSAGE_CLASSIFIER_TIMEOUT_MS: Joi.number().default(5000),
  // Genius Bot API Configuration
  GENIUS_API_URL: Joi.string().uri().default('http://localhost:8000'),
  GENIUS_API_KEY: Joi.string().allow('').default(''),
  QUERY_ROUTING_KEY: Joi.string().allow('').default(''),
  // Outage Verification API Configuration
  OUTAGE_VERIFICATION_AUTH_KEY: Joi.string().allow('').default(''),
  OUTAGE_VERIFICATION_EMAIL: Joi.string().allow('').default(''),
  // Channel ID for the global outage alerts channel
  OUTAGE_ALERT_CHANNEL_ID: Joi.string().allow('').default(''),
  // UPI Analytics Bot API Configuration
  GENIUS_UPI_ANALYTICS_API_URL: Joi.string().uri().default('http://localhost:8000'),
  GENIUS_UPI_ANALYTICS_API_KEY: Joi.string().allow('').default(''),
  GENIUS_UPI_ANALYTICS_USERNAME: Joi.string().allow('').default(''),
  // Xyne Investigation API Configuration
  XYNE_API_KEY: Joi.string().allow('').default(''),
  // Transcription Agent API Key (for S2S authentication)
  TRANSCRIPTION_AGENT_API_KEY: Joi.string().default(''),
  // Mettle user sync webhook API Key (for S2S authentication)
  METTLE_USER_SYNC_API_KEY: Joi.string().allow('').default(''),
  // Team intelligence sync API Key (for S2S authentication)
  TEAM_INTELLIGENCE_SYNC_API_KEY: Joi.string().allow('').default(''),
  // Telepresence monitoring sync API Key (for S2S authentication)
  TELEPRESENCE_MONITORING_API_KEY: Joi.string().allow('').default(''),
  // Max allowed range (in days) for telepresence health time-series queries
  TELEPRESENCE_MONITORING_LIFESPAN: Joi.number().integer().positive().default(7),
  // API-support CSAT sync API Key (for S2S authentication) — shared by any external system posting CSAT results
  API_SUPPORT_CSAT_API_KEY: Joi.string().allow('').default(''),
  // Mettle API Configuration (for fetching employee details)
  METTLE_API_BASE_URL: Joi.string().uri().default(''),
  METTLE_TOKEN: Joi.string().allow('').default(''),
  // Superposition Configuration
  SUPERPOSITION_ENDPOINT: Joi.string().uri().default('http://localhost:9999'),
  SUPERPOSITION_TOKEN: Joi.string().allow('').default('123456'),
  SUPERPOSITION_ORG_ID: Joi.string().allow('').default('localorg'),
  SUPERPOSITION_WORKSPACE_ID: Joi.string().allow('').default('test'),
  SUPERPOSITION_LOTUS_WORKSPACE_ID: Joi.string().allow('').default('lotus'),
  SUPERPOSITION_POLLING_INTERVAL: Joi.number().default(60000), // 60 seconds in milliseconds
  SUPERPOSITION_TIMEOUT: Joi.number().default(30000), // 30 seconds in milliseconds
  // Jenkins Configuration
  JENKINS_BASE_URL: Joi.string().uri().default(''),
  JENKINS_JOB_PATH: Joi.string().default(''),
  JENKINS_USERNAME: Joi.string().allow('').default(''),
  JENKINS_API_TOKEN: Joi.string().allow('').default(''),
  // OpenCode Configuration
  OPENCODE_ENABLED: Joi.boolean().default(false),
  OPENCODE_SPAWN_SERVER: Joi.boolean().default(false),
  OPENCODE_BASE_URL: Joi.string().uri().default('http://localhost:4096'),
  OPENCODE_TIMEOUT_MS: Joi.number().default(600000),
  OPENCODE_AUTO_COMPACT: Joi.boolean().default(false),
  OPENCODE_MODEL: Joi.string().allow('').default(''),
  QUESTION_TIMEOUT_MINUTES: Joi.number().default(2),
  // Default workflow executor when not specified
  DEFAULT_WORKFLOW_EXECUTOR: Joi.string().default('xyne-code'),
  // Default model ID for config sync service
  DEFAULT_MODEL_ID: Joi.string().default(''),
  DEFAULT_MODEL_NAME: Joi.string().default(''),
  // Default workspace ID for integrations that need it
  DEFAULT_WORKSPACE_ID: Joi.string().allow('').default(''),
  // oh-my-opencode Plugin Configuration
  OPENCODE_PLUGIN_ENABLED: Joi.boolean().default(true),
  OPENCODE_PLUGIN_VERSION: Joi.string().allow('').default('latest'),
  // Xyne AI Extended (web search, mem0, deep research, etc.)
  XYNE_AI_EXTENDED_URL: Joi.string().uri().allow('').default(''),
  ENABLE_WORKFLOW_RECOVERY: Joi.boolean().default(true),
  // Otel Configuration
  ENABLE_OTEL_METRICS: Joi.boolean().default(true),
  OTEL_BASE_URL: Joi.string().default('http://localhost:4318'),
  OTEL_SERVICE_NAME: Joi.string().default('xyne-spaces-backend'),
  OTEL_EXPORT_INTERVAL_MS: Joi.number().default(60000),
  SCM_WEBHOOK_SECRET: Joi.string().default(''),
  BITBUCKET_AUTH: Joi.string().allow('').default(''),
  BITBUCKET_SSH_BASE_URL: Joi.string().allow('').default(''),
  // Bitbucket Configuration
  BITBUCKET_BASE_URL: Joi.string().allow('').default(''),
  BITBUCKET_USERNAME: Joi.string().allow('').default(''),
  BITBUCKET_PASSWORD: Joi.string().allow('').default(''),
  BITBUCKET_TOKEN: Joi.string().allow('').default(''),
  JENKINS_WEBHOOK_SECRET: Joi.string().allow('').default(''),
  GITHUB_TOKEN: Joi.string().allow('').default(''),
  GITHUB_API_URL: Joi.string().uri().default('https://api.github.com'),
  //Presence Queue Configuration
  PRESENCE_CLEANUP_INTERVAL_MS: Joi.number().default(600000),
  PRESENCE_OFFLINE_GRACE_PERIOD_MS: Joi.number().default(300000),
  // Pulse Integration
  PULSE_ENABLED_CHANNELS: Joi.string().allow('').default(''),
  PULSE_API_URL: Joi.string().uri().default(''),
  PULSE_AUTHORIZATION: Joi.string().allow('').default(''),
  // Thread catch-up summary — comma-separated channel IDs, or "all" for every channel (empty = disabled everywhere)
  THREAD_SUMMARY_ENABLED_CHANNELS: Joi.string().allow('').default(''),
  THREAD_SUMMARY_MIN_MESSAGES: Joi.number().integer().min(0).default(6),
  THREAD_SUMMARY_MESSAGE_LIMIT: Joi.number().integer().min(1).default(300),
  THREAD_SUMMARY_LLM_TIMEOUT_MS: Joi.number().integer().min(1).default(300000),
  THREAD_SUMMARY_MIN_SUMMARY_MAX_TOKENS: Joi.number().integer().min(1).default(4000),
  THREAD_SUMMARY_MAX_SUMMARY_MAX_TOKENS: Joi.number().integer().min(1).default(20000),
  THREAD_SUMMARY_TRANSCRIPT_CHARS_PER_MAX_TOKEN: Joi.number().integer().min(1).default(10),
  // Jira Configuration
  JUSPAY_JIRA_BASEURL: Joi.string().uri().default(''),
  JIRA_EULER_BOT_EMAIL: Joi.string().allow('').default(''),
  JIRA_EULER_BOT_AUTH_TOKEN: Joi.string().allow('').default(''),
  JIRA_MIGRATION_BOT_EMAIL: Joi.string().allow('').default(''),
  JIRA_MIGRATION_BOT_AUTH_TOKEN: Joi.string().allow('').default(''),
  ZERO_CLIENT_ENCRYPTION_ENABLED: Joi.boolean().default(false),
  API_CLIENT_ENCRYPTION_ENABLED: Joi.boolean().default(false),
  ENABLE_DB_ENCRYPTION: Joi.boolean().default(false),
  ENC_ORG_PROVISION: Joi.boolean().default(false),
  ENC_WORKSPACE_PROVISION: Joi.boolean().default(false),
  JIRA_MIGRATION_USER_MAP_CSV_LOCATION: Joi.string()
    .allow('')
    .default(''),
  JIRA_MIGRATION_ISSUE_PAGE_SIZE: Joi.number().integer().min(1).max(500).default(25),
  // Default to a conservative delay to avoid accidental Jira API hammering in environments
  // where `JIRA_MIGRATION_BATCH_DELAY_MS` isn't explicitly set.
  JIRA_MIGRATION_BATCH_DELAY_MS: Joi.number().integer().min(0).max(600000).default(5000),
  JIRA_MIGRATION_REPORT_CANVAS_CHANNEL_ID: Joi.string().allow('').default(''),
  // Confluence migration configuration
  CONFLUENCE_BASE_URL: Joi.string().allow('').default(''),
  CONFLUENCE_EMAIL: Joi.string().allow('').default(''),
  CONFLUENCE_API_TOKEN: Joi.string().allow('').default(''),
  CONFLUENCE_AUTH_TOKEN: Joi.string().allow('').default(''),
  CONFLUENCE_MIGRATION_FALLBACK_EMAIL: Joi.string().email().default(''),
  CONFLUENCE_IMPORT_BATCH_SIZE: Joi.number().integer().min(1).default(50),
  CONFLUENCE_IMPORT_BATCH_COOLDOWN_MS: Joi.number().integer().min(0).default(5000),
  // Bit-Bot Integration
  ENABLE_FILE_INDEXING: Joi.boolean().default(false),
  // When true, Drive imports are handed to the dedicated background worker (run in
  // worker.ts). When false, the API process runs the import itself (fallback).
  ENABLE_DRIVE_IMPORT_WORKER: Joi.boolean().default(false),
  // Drive import caps (set on whichever process downloads: the drive-import worker,
  // or the API when ENABLE_DRIVE_IMPORT_WORKER is false). Bytes are absolute values.
  DRIVE_IMPORT_MAX_FILE_BYTES: Joi.number().integer().min(1).default(100 * 1024 * 1024), // 100 MB / file
  DRIVE_IMPORT_MAX_FILES: Joi.number().integer().min(1).default(7000), // files per folder import
  DRIVE_IMPORT_MAX_TOTAL_BYTES: Joi.number().integer().min(1).default(1024 * 1024 * 1024), // 1 GB / folder
  DRIVE_IMPORT_MAX_DEPTH: Joi.number().integer().min(1).default(40), // folder nesting depth
  VESPA_QUEUE_NAMES: Joi.string().default('vespa-ingestion'),
  VESPA_FEED_URL: Joi.string().uri().default('http://127.0.0.1:8080'),
  VESPA_QUERY_URL: Joi.string().uri().default('http://127.0.0.1:8081'),
  VESPA_CONFIG_SERVER_URL: Joi.string().uri().default('http://127.0.0.1:19071'),
  // Microsoft Graph API
  MICROSOFT_GRAPH_BASE_URL: Joi.string().uri().default('https://graph.microsoft.com/v1.0'),
  MICROSOFT_GRAPH_CLIENT_STATE_BACKFILL_ENABLED: Joi.boolean().default(true),
  // XYNE Claw Integration (Ask AI v2)
  XYNE_CLAW_URL: Joi.string().uri().default('http://localhost:3002'),
  XYNE_CLAW_S2S_KEY: Joi.string().allow('').default(''),
  XYNE_CLAW_AUTH_URL: Joi.string().uri().default('http://localhost:3003'),
  XYNE_CLAW_WEBHOOK_URL: Joi.string().uri().default('http://localhost:3003/claw/api/v1/webhook'),
  XYNE_CLAW_AUTH_CALLBACK_URL_AUTOMATION: Joi.string()
    .uri()
    .default('http://localhost:3003/claw/api/v1/webhook'),
  XYNE_CLAW_CALLBACK_URL: Joi.string().allow('').default('http://localhost:3001'),
  ASK_AI_VERSION: Joi.string().valid('v1', 'v2').default('v2'),
  // Internal S2S key for service-to-service communication
  INTERNAL_S2S_KEY: Joi.string().allow('').default(''),
  // Stringified JSON mapping external webhook hosts to in-cluster pod base URLs.
  // e.g. {"claw.example.com":"http://claw-auth.svc.cluster.local:3003"}
  INTERNAL_APP_HOST_MAP: Joi.string().allow('').default(''),
  ENC_S2S_KEY: Joi.string().allow(''),
  ENCRYPTION_SERVICE_URL: Joi.string().uri().default('http://localhost:3012'),
  ENCRYPTION_REQUEST_TIMEOUT_MS: Joi.number().integer().min(1).default(5000),
  // Email fetch
  EMAIL_FETCH_BATCH_SIZE: Joi.number().integer().default(10),
  EMAIL_FETCH_BATCH_DELAY_MS: Joi.number().integer().default(5000),
  GMAIL_WEBHOOK_MAX_BATCH: Joi.number().integer().min(1).default(50),
  EMAIL_MERGE_MODE_DEFAULT: Joi.string().valid('DISABLED', 'ENABLED').default('ENABLED'),
  // Docling Configuration
  DOCLING_ENABLED: Joi.boolean().default(false),
  DOCLING_BASE_URL: Joi.string().uri().allow('').default(''),
  DOCLING_HEALTH_ENDPOINT: Joi.string().default('/health'),
  DOCLING_PROCESS_ENDPOINT: Joi.string().default('/process-document/'),
  DOCLING_TIMEOUT_MS: Joi.number().default(240000),
  DOCLING_HEALTH_CACHE_TTL_MS: Joi.number().default(30000),
  DOCLING_DO_OCR: Joi.boolean().default(true),
  // ── Async OCR (Docling/LightOn) scheduler ──────────────────────────────────
  DOCLING_ASYNC_SCHEDULER_ENABLED: Joi.boolean().default(false),
  // When true, the file worker routes COLLECTION PDFs into the async OCR
  // scheduler instead of synchronous FileProcessor parsing.
  DOCLING_ROUTE_PDFS_TO_SCHEDULER: Joi.boolean().default(false),
  // Role for this process: splitter | submitter | result | writer | reaper | all | ''
  DOCLING_SCHEDULER_ROLE: Joi.string()
    .valid('', 'splitter', 'submitter', 'result', 'writer', 'reaper', 'all')
    .default(''),
  DOCLING_SCHEDULER_POLL_MS: Joi.number().default(1000),
  DOCLING_SCHEDULER_LEASE_MS: Joi.number().default(600000),
  DOCLING_SCHEDULER_SPLIT_CONCURRENCY: Joi.number().default(1),
  DOCLING_SCHEDULER_MAX_SPLIT_ATTEMPTS: Joi.number().default(3),
  DOCLING_SCHEDULER_ACTIVE_OCR_FILES: Joi.number().default(4),
  DOCLING_SCHEDULER_ADMITTED_PAGE_BUDGET: Joi.number().default(200),
  DOCLING_SCHEDULER_PER_FILE_INFLIGHT_PARTS: Joi.number().default(2),
  DOCLING_SCHEDULER_PER_FILE_INFLIGHT_PAGES: Joi.number().default(50),
  DOCLING_SCHEDULER_MAX_PART_ATTEMPTS: Joi.number().default(3),
  DOCLING_SCHEDULER_MAX_WRITE_ATTEMPTS: Joi.number().default(5),
  DOCLING_SCHEDULER_SUBMIT_CONCURRENCY: Joi.number().default(4),
  DOCLING_SCHEDULER_SUBMIT_CLAIM_BATCH_SIZE: Joi.number().default(4),
  DOCLING_SCHEDULER_SUBMIT_PREFETCH_MULTIPLIER: Joi.number().default(2),
  DOCLING_SCHEDULER_MAX_CONCURRENT_CLAIMERS: Joi.number().default(1),
  DOCLING_SCHEDULER_SUBMITTER_SHUTDOWN_DRAIN_MS: Joi.number().default(30000),
  DOCLING_SCHEDULER_ADMISSION_POLL_MS: Joi.number().default(2000),
  DOCLING_SCHEDULER_PERMIT_RECONCILE_BATCH: Joi.number().default(200),
  DOCLING_SCHEDULER_RETRY_BASE_MS: Joi.number().default(30000),
  DOCLING_SCHEDULER_RETRY_MAX_MS: Joi.number().default(600000),
  DOCLING_SCHEDULER_VESPA_WRITE_PERMITS: Joi.number().default(1),
  DOCLING_SCHEDULER_VESPA_WRITE_PERMIT_TTL_MS: Joi.number().default(1800000),
  DOCLING_SCHEDULER_VESPA_WRITE_TIMEOUT_MS: Joi.number().default(300000),
  DOCLING_SCHEDULER_MAX_VESPA_PAYLOAD_BYTES: Joi.number().default(9437184),
  DOCLING_PAGE_CHUNK_SIZE: Joi.number().default(25),
  // KB (collection) ingestion gets top priority. BullMQ: lower = higher priority
  // (delete=1). Docling OCR scheduler: higher = processed first (attachments=100).
  KB_INGESTION_QUEUE_PRIORITY: Joi.number().default(2),
  KB_INGESTION_OCR_PRIORITY: Joi.number().default(200),
  ATTACHMENT_OCR_PRIORITY: Joi.number().default(100),
  // Name-only file feed: insert just the file name first (highest priority) so it
  // is searchable in cmd+K within seconds, then a full feed enriches the same doc
  // with parsed content. FILE_NAME_ONLY_FEED_ENABLED gates the two-job behavior;
  // FILE_NAME_ONLY_FEED_PRIORITY is the BullMQ priority for the name-only job
  // (lower = higher; delete=1, so 1 puts it at the top).
  FILE_NAME_ONLY_FEED_ENABLED: Joi.boolean().default(true),
  FILE_NAME_ONLY_FEED_PRIORITY: Joi.number().default(1),
  // Staging on the LOCAL filesystem (a tmp folder in the container). Single-pod only.
  DOCLING_ASYNC_STORAGE_ROOT: Joi.string().default('/tmp/docling-async'),
  DOCLING_KEEP_TEMP_RESULTS: Joi.boolean().default(false),
  // Submit (OCR wrapper) concurrency permits + leases
  DOCLING_ASYNC_SUBMIT_PERMITS: Joi.number().default(16),
  DOCLING_ASYNC_SUBMIT_PERMIT_LEASE_TTL_MS: Joi.number().default(21600000),
  // Redis results stream + consumer group (wrapper publishes to docling:results)
  DOCLING_RESULTS_STREAM: Joi.string().default('docling:results'),
  DOCLING_RESULT_KEY_PREFIX: Joi.string().default('docling:result'),
  DOCLING_SCHEDULER_RESULT_GROUP: Joi.string().default('xyne-spaces-scheduler'),
  DOCLING_RESULT_READ_COUNT: Joi.number().default(2),
  DOCLING_RESULT_BLOCK_MS: Joi.number().default(5000),
  DOCLING_RESULT_MIN_IDLE_MS: Joi.number().default(600000),
  // Dynamic runtime-config hash (permits/concurrency tuning without redeploy)
  DOCLING_RUNTIME_CONFIG_KEY: Joi.string().default('docling:runtime-config'),
  DOCLING_RUNTIME_CONFIG_POLL_MS: Joi.number().default(300000),
  // OCR wrapper service (submitter POSTs parts to /process_async here)
  DOCLING_SERVICE_URL: Joi.string().uri().default('http://localhost:8000'),
  DOCLING_ASYNC_SUBMIT_RETRIES: Joi.number().default(5),
  DOCLING_ASYNC_SUBMIT_RETRY_DELAY_MS: Joi.number().default(1000),
  DOCLING_ASYNC_SUBMIT_TIMEOUT_MS: Joi.number().default(120000),
  // ── Multi-engine PDF fallback ladder (sync processWithFallback) ────────────
  // Env names kept identical to xyne-search to avoid cross-repo confusion.
  // Hard reject PDFs over this page count before any engine runs.
  MAX_PDF_PAGE_COUNT: Joi.number().integer().positive().default(1000),
  // When true, the fallback ladder fails on the first engine's error (no degrade).
  PDF_PROCESSING_DISABLE_FALLBACKS: Joi.boolean().default(false),
  // LightOnOCR synchronous fallback engine (the Mode B OCR step) — calls the
  // wrapper's /process endpoint. Enabled when a URL is set. LightOnOCR is the
  // single OCR engine (no Paddle): the fallback retries the same model
  // synchronously before degrading to PdfJs.
  PDF_LIGHTONOCR_SYNC_URL: Joi.string().allow('').default(''),
  PDF_LIGHTONOCR_SYNC_TIMEOUT_MS: Joi.number().default(600000),
  // xyne-spaces-only: when the async OCR scheduler exhausts a file, degrade to
  // the sync ladder instead of dropping it. (No xyne-search equivalent.)
  PDF_ASYNC_SYNC_FALLBACK_ENABLED: Joi.boolean().default(true),
  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().integer().min(1).max(65535).default(6379),
  REDIS_PASSWORD: Joi.string().allow('').default(''),
  REDIS_TLS: Joi.boolean().default(false),
  DATA_SOURCE_INGEST_TABLE_LIMIT: Joi.number().integer().positive().default(30),
  DATA_SOURCE_EDA_CONCURRENCY: Joi.number().integer().min(1).default(4),
  DATA_SOURCE_ALLOW_PRIVATE_HOSTS: Joi.boolean().default(false),
  SDK_API_ENABLED: Joi.boolean().default(false),

}).unknown();

const { error, value: envVars } = envSchema.validate(process.env);

if (error) {
  throw new Error(`Config validation error: ${error.message}`);
}

export const config = {
  env: envVars.NODE_ENV,
  isTestEnv: envVars.NODE_ENV === 'test',
  isSandboxTestMode: envVars.SANDBOX_TEST_MODE === true,
  orgMemberLimit: (envVars.ORG_MEMBER_LIMIT as number | null) ?? null,
  research_agent_url: envVars.RESEARCH_AGENT_URL,
  pythonAgentUrl: envVars.PYTHON_AGENT_URL as string,
  nx_graph_server_url: envVars.NX_GRAPH_SERVER_URL,
  nx_graph_server_urls: envVars.NX_GRAPH_SERVER_URLS
    ? envVars.NX_GRAPH_SERVER_URLS.split(',').map((url: string) => url.trim())
    : [envVars.NX_GRAPH_SERVER_URL],
  research_agent_api_key: envVars.RESEARCH_AGENT_API_KEY,
  use_mock_analysis: envVars.USE_MOCK_ANALYSIS,
  use_mock_build: envVars.USE_MOCK_BUILD,
  // Email of the Digital Twin app's bot user (empty = twin delivery disabled).
  digitalTwinAppEmail: envVars.DIGITAL_TWIN_APP_EMAIL as string,
  port: envVars.PORT,
  // Normalized to '/sdlc-api' form, or ''.
  apiPathPrefix: (envVars.API_PATH_PREFIX as string)
    ? `/${(envVars.API_PATH_PREFIX as string).trim().replace(/^\/+|\/+$/g, '')}`
    : '',
  host: envVars.HOST,
  cors: {
    origin: envVars.CORS_ORIGIN.split(',')
      .map((origin: string) => origin.trim())
      .filter(Boolean),
    allowedMediaOrigins: envVars.ALLOWED_MEDIA_ORIGINS.split(',')
      .map((origin: string) => origin.trim())
      .filter(Boolean),
  },
  rateLimit: {
    windowMs: envVars.RATE_LIMIT_WINDOW_MS,
    max: envVars.RATE_LIMIT_MAX_REQUESTS,
  },
  logging: {
    level: envVars.LOG_LEVEL,
    fluent: {
      enabled: envVars.LOG_FLUENT_ENABLED,
      host: envVars.LOG_FLUENT_HOST,
      port: envVars.LOG_FLUENT_PORT,
    },
    logUserSessionChanges: envVars.LOG_USER_SESSION_CHANGES,
  },
  database: {
    url: envVars.DATABASE_URL,
    readReplicaPoolUrl: envVars.DATABASE_READ_REPLICA_POOL_URL,
  },
  sdk: {
    /** Master switch. The router is not mounted at all when false. */
    enabled: envVars.SDK_API_ENABLED,
    /**
     * Development escape hatch: run reads against the primary pool when no read
     * replica is configured. Tied to `NODE_ENV` rather than its own flag — the
     * replica exists to keep SDK read traffic off the write path, and that
     * matters precisely in production, so there is nothing a separate switch
     * would let a deployment opt out of that `NODE_ENV` does not already decide.
     */
    allowPrimaryForReads: envVars.NODE_ENV !== 'production',
  },
  commonDatabase: {
    url: envVars.COMMON_DATABASE_URL,
    poolSize: envVars.COMMON_DATABASE_POOL_SIZE,
    poolTimeoutSeconds: envVars.COMMON_DATABASE_POOL_TIMEOUT_SECONDS,
    ticketSequenceEnabled: envVars.ENABLE_COMMON_DB_TICKET_SEQUENCE,
  },
  workflow: {
    lockDurationMs: envVars.WORKFLOW_LOCK_DURATION_MS,
    defaultExecutor: envVars.DEFAULT_WORKFLOW_EXECUTOR,
    defaultModelId: envVars.DEFAULT_MODEL_ID,
    defaultModelName: envVars.DEFAULT_MODEL_NAME,
  },
  defaultWorkspaceId: envVars.DEFAULT_WORKSPACE_ID,
  fileStorage: {
    provider: envVars.STORAGE_PROVIDER,
  },
  s3: {
    region: envVars.AWS_REGION,
    accessKeyId: envVars.AWS_ACCESS_KEY_ID,
    secretAccessKey: envVars.AWS_SECRET_ACCESS_KEY,
    bucketName: envVars.S3_BUCKET_NAME,
    endpoint: envVars.S3_ENDPOINT,
  },
  llm: {
    litellmApiKey: envVars.LITELLM_API_KEY,
    litellmBaseUrl: envVars.LITELLM_BASE_URL,
    litellmModel: envVars.ACTIVITY_CLASSIFICATION_MODEL,
    requestTimeoutMs: envVars.LLM_REQUEST_TIMEOUT_MS,
    teamIntelligenceRequestTimeoutMs: envVars.TEAM_INTELLIGENCE_LLM_REQUEST_TIMEOUT_MS,
    // Call-specific LiteLLM config (falls back to main litellm if not set)
    callLitellmApiKey: envVars.CALL_LITELLM_API_KEY || envVars.LITELLM_API_KEY,
    callLitellmModel: envVars.CALL_LITELLM_MODEL,
    // Fast (default) and thinking model tiers; both fall back to CALL_LITELLM_MODEL.
    callRecordingFastLitellmModel:
      envVars.CALL_RECORDING_FAST_LITELLM_MODEL || envVars.CALL_LITELLM_MODEL,
    callRecordingThinkingLitellmModel:
      envVars.CALL_RECORDING_THINKING_LITELLM_MODEL || envVars.CALL_LITELLM_MODEL,
  },
  activityClassification: {
    litellmApiKey: envVars.ACTIVITY_CLASSIFICATION_LITELLM_API_KEY,
    model: envVars.ACTIVITY_CLASSIFICATION_MODEL,
    maxRetries: envVars.ACTIVITY_CLASSIFICATION_MAX_RETRIES,
  },
  langfuse: {
    baseUrl: envVars.LANGFUSE_BASE_URL,
    publicKey: envVars.LANGFUSE_PUBLIC_KEY,
    secretKey: envVars.LANGFUSE_SECRET_KEY,
  },
  migrationEncryption: {
    keys: envVars.MIGRATION_ENC_KEYS,
    activeKeyId: envVars.MIGRATION_ENC_ACTIVE,
  },
  runSlackMigrationWorkers: envVars.RUN_SLACK_MIGRATION_WORKERS,
  slackMigration: {
    pageDelayMs: envVars.MIGRATION_SLACK_PAGE_DELAY_MS,
    listDelayMs: envVars.MIGRATION_SLACK_LIST_DELAY_MS,
    fileTimeoutMs: envVars.MIGRATION_SLACK_FILE_TIMEOUT_MS,
    requestTimeoutMs: envVars.MIGRATION_SLACK_REQUEST_TIMEOUT_MS,
    stallLimitMs: envVars.MIGRATION_SLACK_STALL_LIMIT_MS,
    ingestMessageDelayMs: envVars.MIGRATION_INGEST_MESSAGE_DELAY_MS,
  },
  gcs: {
    projectId: envVars.GCS_PROJECT_ID,
    bucketName: envVars.GCS_BUCKET_NAME,
    migrationBucketName: envVars.MIGRATION_GCS_BUCKET,
    bundleBucketName: envVars.GCS_BUNDLE_BUCKET_NAME,
    canvasBucketName: envVars.GCS_CANVAS_BUCKET_NAME,
    docsBucketName: envVars.GCS_DOCS_BUCKET_NAME,
    workflowStepsBucketName: envVars.GCS_WORKFLOW_STEPS_BUCKET_NAME,
    sessionRecordingBucketName: envVars.GCS_SESSION_RECORDING_BUCKET_NAME,
    workflowVRBucketName: envVars.GCS_WORKFLOW_VR_BUCKET_NAME,
    maxFileSizeMB: envVars.GCS_MAX_FILE_SIZE_MB,
    fakeGcsHost: envVars.FAKE_GCS_HOST,
    transcriptionBucketName: envVars.TRANSCRIPTION_BUCKET_NAME,
  },
  enableWorkflowStepGcsSync: envVars.ENABLE_WORKFLOW_STEP_GCS_SYNC,
  enableConversationIngestionQueue: envVars.ENABLE_CONVERSATION_INGESTION_QUEUE,
  enableConversationIngestionWorker: envVars.ENABLE_CONVERSATION_INGESTION_WORKER,
  enableScheduledMessageWorker: envVars.ENABLE_SCHEDULED_MESSAGE_WORKER,
  enableStageEtaDeadlineWorker: envVars.ENABLE_STAGE_ETA_DEADLINE_WORKER,
  enableEtaDeadlineWorker: envVars.ENABLE_ETA_DEADLINE_WORKER,
  enableAutomationWorker: envVars.ENABLE_AUTOMATION_WORKER,
  enableDelayedMessageWorker: envVars.ENABLE_DELAYED_MESSAGE_WORKER,
  enableEmailFetchWorker: envVars.ENABLE_EMAIL_FETCH_WORKER,
  enableCalendarSyncWorker: envVars.ENABLE_CALENDAR_SYNC_WORKER,
  deskTicketDebug: envVars.DESK_TICKET_DEBUG as boolean,
  enableEmailClassificationWorker: envVars.ENABLE_EMAIL_CLASSIFICATION_WORKER,
  // Radar execution engine. Two switches: enqueue on message insert, and run
  // the drain worker. A gated window always goes to the parser and a valid
  // transition is always applied — there is no separate dry-run mode.
  radar: {
    enabled: envVars.ENABLE_RADAR_EXECUTION as boolean,
    // Required once radar is enabled — a blank model throws at parse time.
    parserModel: envVars.RADAR_PARSER_MODEL as string,
    // Blank falls back to the shared LITELLM_API_KEY. A dedicated key keeps
    // radar's rate limit and spend off the quota other features draw on.
    litellmApiKey: envVars.RADAR_EXECUTION_LITELLM_API_KEY as string,
    maxWindowMessages: envVars.RADAR_MAX_WINDOW_MESSAGES as number,
    workerConcurrency: envVars.RADAR_EXECUTION_WORKER_CONCURRENCY as number,
    // execution_run_logs is the fastest-growing table here — one row per
    // drain pass, carrying full LLM payloads. Swept on a timer by the worker.
    runLogRetentionDays: envVars.RADAR_RUN_LOG_RETENTION_DAYS as number,
  },
  enableTeamIntelligenceWorker: envVars.ENABLE_TEAM_INTELLIGENCE_WORKER,
  teamIntelligence: {
    model: envVars.TEAM_INTELLIGENCE_LLM_MODEL as string,
    userJobConcurrency: envVars.TEAM_INTELLIGENCE_USER_JOB_CONCURRENCY as number,
    teamJobConcurrency: envVars.TEAM_INTELLIGENCE_TEAM_JOB_CONCURRENCY as number,
    orgJobConcurrency: envVars.TEAM_INTELLIGENCE_ORG_JOB_CONCURRENCY as number,
    llmGlobalConcurrency: envVars.TEAM_INTELLIGENCE_LLM_GLOBAL_CONCURRENCY as number,
    sectionConcurrency: envVars.TEAM_INTELLIGENCE_SECTION_CONCURRENCY as string,
    userSectionConcurrency: envVars.TEAM_INTELLIGENCE_USER_SECTION_CONCURRENCY as string,
    teamSectionConcurrency: envVars.TEAM_INTELLIGENCE_TEAM_SECTION_CONCURRENCY as string,
    orgSectionConcurrency: envVars.TEAM_INTELLIGENCE_ORG_SECTION_CONCURRENCY as string,
  },
  enableTagGenerationPipeline: envVars.ENABLE_TAG_GENERATION_PIPELINE,
  tagGenerationConcurrency: envVars.TAG_GENERATION_CONCURRENCY as number,
  tagGenerationLlmTimeoutMs: envVars.TAG_GENERATION_LLM_TIMEOUT_MS as number,
  enableStitchWorker: envVars.ENABLE_STITCH_WORKER,
  enableAiProvisioningWorker: envVars.ENABLE_AI_PROVISIONING_WORKER,
  enableSdlcWorker: envVars.ENABLE_SDLC_WORKER as boolean,
  sdlcGlobalActiveLimit: envVars.SDLC_GLOBAL_ACTIVE_LIMIT as number,
  sdlcRepoActiveLimit: envVars.SDLC_REPO_ACTIVE_LIMIT as number,
  sdlcCapacityWaitTimeoutMs: envVars.SDLC_CAPACITY_WAIT_TIMEOUT_MS as number,
  sdlcCapacityRetryDelayMs: envVars.SDLC_CAPACITY_RETRY_DELAY_MS as number,
  sdlcClawRunTimeoutMs: envVars.SDLC_CLAW_RUN_TIMEOUT_MS as number,
  aiProvisioning: {
    xyneClawAuthInternalUrl: envVars.XYNE_CLAW_AUTH_INTERNAL_URL as string,
    enableUserProvisioning: envVars.ENABLE_USER_AI_PROVISIONING as boolean,
    s2sKey: envVars.XYNE_CLAW_S2S_KEY as string,
    queueAttempts: envVars.AI_PROVISIONING_QUEUE_ATTEMPTS as number,
    queueBackoffMs: envVars.AI_PROVISIONING_QUEUE_BACKOFF_MS as number,
    requestTimeoutMs: envVars.AI_PROVISIONING_REQUEST_TIMEOUT_MS as number,
    communityWorkspaceUserBudget:
      (envVars.COMMUNITY_WORKSPACE_USER_BUDGET as number | null) ?? null,
    enterpriseWorkspaceUserBudget:
      (envVars.ENTERPRISE_WORKSPACE_USER_BUDGET as number | null) ?? null,
    litellmManagementBaseUrl:
      (envVars.LITELLM_MANAGEMENT_BASE_URL as string) || (envVars.LITELLM_BASE_URL as string),
    litellmManagementAdminKey: envVars.LITELLM_MANAGEMENT_ADMIN_KEY as string,
    litellmChangedBy: envVars.LITELLM_CHANGED_BY as string,
    orgDefaultModels: (envVars.ORG_DEFAULT_MODELS as string)
      .split(',')
      .map((m: string) => m.trim())
      .filter(Boolean),
  },
  backendUrl: envVars.BACKEND_URL,
  slackBotToken: envVars.SLACK_BOT_TOKEN,
  slackFrontendUrl: envVars.SLACK_FRONTEND_URL,
  frontendUrl: envVars.FRONTEND_URL,
  followHeaderRedirection: envVars.FOLLOW_HEADER_REDIRECTION,
  trustedOriginalHostDomains: envVars.TRUSTED_ORIGINAL_HOST_DOMAINS.split(',')
    .map((domain: string) => domain.trim().toLowerCase())
    .filter(Boolean),
  googleAuthRedirectUri: envVars.GOOGLE_AUTH_REDIRECT_URI as string,
  microsoftAuthRedirectUri: envVars.MICROSOFT_AUTH_REDIRECT_URI as string,
  externalCallInviteBaseUrl: envVars.EXTERNAL_CALL_INVITE_BASE_URL,
  slackSigningSecret: envVars.SLACK_SIGNING_SECRET,
  slackMigrationApprovals: envVars.SLACK_MIGRATION_APPROVALS
    ? envVars.SLACK_MIGRATION_APPROVALS.split(',')
        .map((id: string) => id.trim())
        .filter(Boolean)
    : [],
  slackIgnoredBotIds: envVars.SLACK_IGNORED_BOT_IDS
    ? envVars.SLACK_IGNORED_BOT_IDS.split(',')
        .map((id: string) => id.trim())
        .filter(Boolean)
    : [],
  slackMigrationFinalMessage: envVars.SLACK_MIGRATION_FINAL_MESSAGE
    ? Buffer.from(envVars.SLACK_MIGRATION_FINAL_MESSAGE, 'base64').toString('utf-8')
    : '',
  slackMigrationLogChannelId: envVars.SLACK_MIGRATION_LOG_CHANNEL_ID,
  slackMigrationCreatorEmail: envVars.SLACK_MIGRATION_CREATOR_EMAIL as string,
  autoSyncSlackChannel: {
    enabled: envVars.ENABLE_SLACK_MIGRATION_WORKER,
    sheetId: envVars.MIGRATION_SHEET_ID,
    concurrency: envVars.SLACK_MIGRATION_CONCURRENCY as number,
    syncCron: envVars.SLACK_MIGRATION_SYNC_CRON as string,
    cleanupCron: envVars.SLACK_MIGRATION_CLEANUP_CRON as string,
  },
  syncDm: {
    concurrency: envVars.SYNC_DM_CONCURRENCY as number,
    logChannelId: envVars.SYNC_DM_LOG_CHANNEL as string,
  },
  slackMigrationNotificationsEnabled: envVars.SLACK_MIGRATION_NOTIFICATIONS_ENABLED,
  migrationSlackBotConfigs: envVars.MIGRATION_SLACK_BOT_CONFIGS as string,
  sam: {
    baseUrl: envVars.SAM_BASE_URL,
    apiKey: envVars.SAM_API_KEY,
  },
  livekit: {
    apiKey: envVars.LIVEKIT_API_KEY,
    apiSecret: envVars.LIVEKIT_API_SECRET,
    url: envVars.LIVEKIT_URL,
    clientUrl: envVars.LIVEKIT_CLIENT_URL,
    serverUrl: envVars.LIVEKIT_SERVER_URL,
  },
  callRecording: {
    enabled: envVars.CALL_RECORDING_ENABLED,
    retentionDays: envVars.CALL_RECORDING_RETENTION_DAYS,
  },
  screenRecording: {
    retentionDays: envVars.SCREEN_RECORDING_RETENTION_DAYS,
  },
  fcm: {
    projectId: envVars.FCM_PROJECT_ID,
    serviceAccountBase64: envVars.FCM_SERVICE_ACCOUNT_BASE64,
    projectIdNew: envVars.FCM_PROJECT_ID_NEW,
    serviceAccountBase64New: envVars.FCM_SERVICE_ACCOUNT_BASE64_NEW,
  },
  apns: {
    keyId: envVars.APNS_KEY_ID,
    teamId: envVars.APNS_TEAM_ID,
    bundleId: envVars.APNS_BUNDLE_ID,
    p8Base64: envVars.APNS_P8_BASE64,
  },
  ysweet: {
    url: envVars.Y_SWEET_URL,
    serverToken: envVars.Y_SWEET_SERVER_TOKEN,
  },
  entityExtraction: {
    enabled: envVars.ENABLE_ENTITY_EXTRACTION,
    model: envVars.ENTITY_EXTRACTION_MODEL,
    // A single extraction call takes 20-75s on this endpoint. Raising this
    // makes calls contend and time out rather than finish faster.
    concurrency: envVars.ENTITY_EXTRACTION_CONCURRENCY,
    debounceMs: envVars.ENTITY_EXTRACTION_DEBOUNCE_MS,
    orgContext: envVars.ENTITY_EXTRACTION_ORG_CONTEXT,
  },

  litellm: {
    baseUrl: envVars.LITELLM_BASE_URL,
    apiKey: envVars.LITELLM_API_KEY,
    askAiApiKey: envVars.ASK_AI_LITELLM_API_KEY || envVars.LITELLM_API_KEY,
    threadTypeClassificationApiKey: envVars.THREAD_TYPE_CLASSIFICATION_LITELLM_API_KEY,
    imageGenerationEndpoint: envVars.IMAGE_GENERATION_ENDPOINT,
    imageGenerationModel: envVars.IMAGE_GENERATION_MODEL,
    documentOutlineEnabled: envVars.DOCUMENT_OUTLINE_ENABLED,
  },
  dashboard: {
    aiSsePingIntervalMs: envVars.DASHBOARD_AI_SSE_PING_INTERVAL_MS,
    aiTopValuesInlineLimit: envVars.DASHBOARD_AI_TOP_VALUES_INLINE_LIMIT,
    queryCacheTtlSec: envVars.DASHBOARD_QUERY_CACHE_TTL_SEC,
    queryCacheMaxValueBytes: envVars.DASHBOARD_QUERY_CACHE_MAX_VALUE_BYTES,
    pgStatementTimeoutMs: envVars.DASHBOARD_PG_STATEMENT_TIMEOUT_MS,
    pgConnectionTimeoutMs: envVars.DASHBOARD_PG_CONNECTION_TIMEOUT_MS,
    chRequestTimeoutMs: envVars.DASHBOARD_CH_REQUEST_TIMEOUT_MS,
  },
  productInsights: {
    recluster: {
      cron: envVars.PRODUCT_INSIGHTS_RECLUSTER_CRON,
      windowDays: envVars.PRODUCT_INSIGHTS_RECLUSTER_WINDOW_DAYS,
    },
  },
  messageClassifier: {
    url: envVars.MESSAGE_CLASSIFIER_URL,
    timeoutMs: envVars.MESSAGE_CLASSIFIER_TIMEOUT_MS,
  },
  genius: {
    apiUrl: envVars.GENIUS_API_URL,
    apiKey: envVars.GENIUS_API_KEY,
    queryRoutingKey: envVars.QUERY_ROUTING_KEY,
  },
  outageVerification: {
    authKey: envVars.OUTAGE_VERIFICATION_AUTH_KEY,
    email: envVars.OUTAGE_VERIFICATION_EMAIL,
    channelId: envVars.OUTAGE_ALERT_CHANNEL_ID,
  },
  geniusUpiAnalytics: {
    apiUrl: envVars.GENIUS_UPI_ANALYTICS_API_URL,
    apiKey: envVars.GENIUS_UPI_ANALYTICS_API_KEY,
    username: envVars.GENIUS_UPI_ANALYTICS_USERNAME,
  },
  xyne: {
    apiKey: envVars.XYNE_API_KEY,
  },
  transcriptionAgentApiKey: envVars.TRANSCRIPTION_AGENT_API_KEY,
  mettleUserSyncApiKey: envVars.METTLE_USER_SYNC_API_KEY,
  teamIntelligenceSyncApiKey: envVars.TEAM_INTELLIGENCE_SYNC_API_KEY,
  telepresenceMonitoringApiKey: envVars.TELEPRESENCE_MONITORING_API_KEY,
  telepresenceMonitoringLifespanDays: envVars.TELEPRESENCE_MONITORING_LIFESPAN,
  apiSupportCsatApiKey: envVars.API_SUPPORT_CSAT_API_KEY,
  mettleApiBaseUrl: envVars.METTLE_API_BASE_URL,
  mettleToken: envVars.METTLE_TOKEN,
  bitbucket: {
    webhookSecret: envVars.SCM_WEBHOOK_SECRET,
    apiToken: envVars.BITBUCKET_AUTH,
    apiUsername: envVars.BITBUCKET_USERNAME,
    sshBaseUrl: envVars.BITBUCKET_SSH_BASE_URL,
    baseUrl: envVars.BITBUCKET_BASE_URL,
    password: envVars.BITBUCKET_PASSWORD,
  },
  github: {
    webhookSecret: envVars.SCM_WEBHOOK_SECRET,
    token: envVars.GITHUB_TOKEN,
    apiUrl: envVars.GITHUB_API_URL,
  },
  workingHours: {
    start: envVars.WORKING_HOUR_START,
    end: envVars.WORKING_HOUR_END,
  },
  superposition: {
    endpoint: envVars.SUPERPOSITION_ENDPOINT,
    token: envVars.SUPERPOSITION_TOKEN,
    orgId: envVars.SUPERPOSITION_ORG_ID,
    workspaceId: envVars.SUPERPOSITION_WORKSPACE_ID,
    lotusWorkspaceId: envVars.SUPERPOSITION_LOTUS_WORKSPACE_ID,
    pollingInterval: envVars.SUPERPOSITION_POLLING_INTERVAL,
    timeout: envVars.SUPERPOSITION_TIMEOUT,
  },
  jenkins: {
    baseUrl: envVars.JENKINS_BASE_URL,
    jobPath: envVars.JENKINS_JOB_PATH,
    username: envVars.JENKINS_USERNAME,
    apiToken: envVars.JENKINS_API_TOKEN,
    webhookSecret: envVars.JENKINS_WEBHOOK_SECRET,
  },
  openCode: {
    enabled: envVars.OPENCODE_ENABLED,
    spawnServer: envVars.OPENCODE_SPAWN_SERVER,
    baseUrl: envVars.OPENCODE_BASE_URL,
    timeoutMs: envVars.OPENCODE_TIMEOUT_MS,
    autoCompact: envVars.OPENCODE_AUTO_COMPACT,
    model: envVars.OPENCODE_MODEL,
    // oh-my-opencode plugin settings
    pluginEnabled: envVars.OPENCODE_PLUGIN_ENABLED,
    pluginVersion: envVars.OPENCODE_PLUGIN_VERSION,
  },
  workflowRecoveryEnabled: envVars.ENABLE_WORKFLOW_RECOVERY,
  ticketDescriptionClean: {
    model: envVars.TICKET_DESC_CLEAN_MODEL,
    maxRetries: envVars.TICKET_DESC_CLEAN_MAX_RETRIES,
  },
  questionTimeoutMinutes: envVars.QUESTION_TIMEOUT_MINUTES,
  workerSchedulerEnabled: envVars.ENABLE_WORKER_SCHEDULER,

  workflows: {
    workerEnabled: envVars.ENABLE_WORKFLOWS_WORKER as boolean,
    workerConcurrency: envVars.WORKFLOWS_WORKER_CONCURRENCY as number,
    lockDurationMs: envVars.WORKFLOWS_LOCK_DURATION_MS as number,
    baseUrl: (envVars.WORKFLOWS_BASE_URL || envVars.BACKEND_URL) as string,
  },
  ticketCleanupWorkerEnabled: envVars.ENABLE_TICKET_CLEANUP_WORKER,
  notificationWorkerEnabled: envVars.ENABLE_NOTIFICATION_WORKER,
  messageClassificationEnabled: envVars.ENABLE_MESSAGE_CLASSIFICATION,
  messageClassification: {
    model: envVars.MESSAGE_CLASSIFIER_MODEL,
  },
  runWorkerInBackend: envVars.RUN_WORKER_IN_BACKEND,
  recapScheduler: {
    enabled: envVars.ENABLE_RECAP_SCHEDULER,
    generationCron: envVars.RECAP_GENERATION_CRON,
    cleanupCron: envVars.RECAP_CLEANUP_CRON,
    retentionDays: envVars.RECAP_RETENTION_DAYS,
  },
  deskReportScheduler: {
    enabled: envVars.ENABLE_DESK_REPORT_SCHEDULER,
    generationCron: envVars.DESK_REPORT_GENERATION_CRON,
    cleanupCron: envVars.DESK_REPORT_CLEANUP_CRON,
    retentionDays: envVars.DESK_REPORT_RETENTION_DAYS,
  },
  otel: {
    metricsEnabled: envVars.ENABLE_OTEL_METRICS,
    baseUrl: envVars.OTEL_BASE_URL,
    serviceName: envVars.OTEL_SERVICE_NAME,
    exportIntervalMs: envVars.OTEL_EXPORT_INTERVAL_MS,
  },
  xyneAiExtended: {
    url: envVars.XYNE_AI_EXTENDED_URL,
  },
  jwt: {
    expirationSeconds: envVars.JWT_EXPIRATION_SECONDS,
    forceLogoutBefore: envVars.FORCE_LOGOUT_BEFORE,
  },
  session: {
    expiryDays: envVars.SESSION_EXPIRY_DAYS,
  },
  pendingOAuthTokens: {
    redisKeyPrefix: 'pendingauth:oauth:',
    ttlSeconds: 10 * 60,
  },
  recentVisitedConversations: {
    lookbackDays: envVars.RECENT_VISITED_LOOKBACK_DAYS,
  },
  pulse: {
    // Comma-separated channel IDs that have Pulse enabled (empty = disabled everywhere)
    enabledChannels: (envVars.PULSE_ENABLED_CHANNELS as string)
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean),
    apiUrl: envVars.PULSE_API_URL as string,
    authorization: envVars.PULSE_AUTHORIZATION as string,
  },
  threadSummary: {
    // Comma-separated channel IDs that have the AI thread catch-up summary enabled, or "all" for every channel (empty = disabled everywhere)
    enabledChannels: (envVars.THREAD_SUMMARY_ENABLED_CHANNELS as string)
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean),
    minMessages: envVars.THREAD_SUMMARY_MIN_MESSAGES as number,
    messageLimit: envVars.THREAD_SUMMARY_MESSAGE_LIMIT as number,
    llmTimeoutMs: envVars.THREAD_SUMMARY_LLM_TIMEOUT_MS as number,
    minSummaryMaxTokens: envVars.THREAD_SUMMARY_MIN_SUMMARY_MAX_TOKENS as number,
    maxSummaryMaxTokens: envVars.THREAD_SUMMARY_MAX_SUMMARY_MAX_TOKENS as number,
    transcriptCharsPerMaxToken: envVars.THREAD_SUMMARY_TRANSCRIPT_CHARS_PER_MAX_TOKEN as number,
  },
  jira: {
    baseUrl: envVars.JUSPAY_JIRA_BASEURL as string,
    eulerBotEmail: envVars.JIRA_EULER_BOT_EMAIL as string,
    eulerBotAuthToken: envVars.JIRA_EULER_BOT_AUTH_TOKEN as string,
    migrationBotEmail: envVars.JIRA_MIGRATION_BOT_EMAIL as string,
    migrationBotAuthToken: envVars.JIRA_MIGRATION_BOT_AUTH_TOKEN as string,
    migrationUserMapCsvLocation: envVars.JIRA_MIGRATION_USER_MAP_CSV_LOCATION as string,
  },
  jiraMigration: {
    issuePageSize: envVars.JIRA_MIGRATION_ISSUE_PAGE_SIZE as number,
    batchDelayMs: envVars.JIRA_MIGRATION_BATCH_DELAY_MS as number,
    reportCanvasChannelId: envVars.JIRA_MIGRATION_REPORT_CANVAS_CHANNEL_ID as string,
  },
  confluence: {
    baseUrl: envVars.CONFLUENCE_BASE_URL as string,
    email: envVars.CONFLUENCE_EMAIL as string,
    apiToken: envVars.CONFLUENCE_API_TOKEN as string,
    authToken: envVars.CONFLUENCE_AUTH_TOKEN as string,
    migrationFallbackEmail: envVars.CONFLUENCE_MIGRATION_FALLBACK_EMAIL as string,
    importBatchSize: envVars.CONFLUENCE_IMPORT_BATCH_SIZE as number,
    importBatchCooldownMs: envVars.CONFLUENCE_IMPORT_BATCH_COOLDOWN_MS as number,
  },
  enc: {
    clientEncryptionEnabled: envVars.ZERO_CLIENT_ENCRYPTION_ENABLED as boolean,
    apiClientEncryptionEnabled: envVars.API_CLIENT_ENCRYPTION_ENABLED as boolean,
    enableDbEncryption: envVars.ENABLE_DB_ENCRYPTION as boolean,
    orgProvisionEnabled: envVars.ENC_ORG_PROVISION as boolean,
    workspaceProvisionEnabled: envVars.ENC_WORKSPACE_PROVISION as boolean,
  },
  enableFileIndexing: envVars.ENABLE_FILE_INDEXING as boolean,
  enableDriveImportWorker: envVars.ENABLE_DRIVE_IMPORT_WORKER as boolean,
  driveImport: {
    maxFileBytes: envVars.DRIVE_IMPORT_MAX_FILE_BYTES as number,
    maxFiles: envVars.DRIVE_IMPORT_MAX_FILES as number,
    maxTotalBytes: envVars.DRIVE_IMPORT_MAX_TOTAL_BYTES as number,
    maxDepth: envVars.DRIVE_IMPORT_MAX_DEPTH as number,
  },
  email: {
    clientId: envVars.GOOGLE_CLIENT_ID as string,
    clientSecret: envVars.GOOGLE_CLIENT_SECRET as string,
    refreshToken: envVars.GOOGLE_REFRESH_TOKEN as string,
    fromEmail: envVars.EMAIL_FROM as string,
    fromName: envVars.EMAIL_FROM_NAME as string,
  },
  communityJoinApprovedEmail: {
    message: envVars.COMMUNITY_JOIN_APPROVED_EMAIL_MESSAGE as string,
  },
  microsoftGraph: {
    baseUrl: envVars.MICROSOFT_GRAPH_BASE_URL as string,
    clientStateBackfillEnabled: envVars.MICROSOFT_GRAPH_CLIENT_STATE_BACKFILL_ENABLED as boolean,
  },
  xyneClaw: {
    url: envVars.XYNE_CLAW_URL as string,
    s2sKey: envVars.XYNE_CLAW_S2S_KEY as string,
    authUrl: envVars.XYNE_CLAW_AUTH_URL as string,
    webhookUrl: envVars.XYNE_CLAW_WEBHOOK_URL as string,
    clawAuthCallbackUrlAutomation: envVars.XYNE_CLAW_AUTH_CALLBACK_URL_AUTOMATION as string,
    callbackUrl: (envVars.XYNE_CLAW_CALLBACK_URL || envVars.BACKEND_URL) as string,
  },
  internalS2sKey: envVars.INTERNAL_S2S_KEY as string,
  apps: {
    internalHostMap: parseInternalAppHostMap(envVars.INTERNAL_APP_HOST_MAP as string),
  },
  askAI: {
    version: envVars.ASK_AI_VERSION as 'v1' | 'v2',
  },
  internal: {
    encryptionS2sKey: envVars.ENC_S2S_KEY as string,
    encryptionServiceUrl: envVars.ENCRYPTION_SERVICE_URL as string,
    encryptionRequestTimeoutMs: envVars.ENCRYPTION_REQUEST_TIMEOUT_MS as number,
  },
  emailFetch: {
    batchSize: envVars.EMAIL_FETCH_BATCH_SIZE as number,
    batchDelayMs: envVars.EMAIL_FETCH_BATCH_DELAY_MS as number,
    gmailWebhookMaxBatch: envVars.GMAIL_WEBHOOK_MAX_BATCH as number,
  },
  emailMergeModeDefault: envVars.EMAIL_MERGE_MODE_DEFAULT as 'DISABLED' | 'ENABLED',
  docling: {
    enabled: envVars.DOCLING_ENABLED as boolean,
    baseUrl: envVars.DOCLING_BASE_URL as string,
    healthEndpoint: envVars.DOCLING_HEALTH_ENDPOINT as string,
    processEndpoint: envVars.DOCLING_PROCESS_ENDPOINT as string,
    timeoutMs: envVars.DOCLING_TIMEOUT_MS as number,
    healthCacheTtlMs: envVars.DOCLING_HEALTH_CACHE_TTL_MS as number,
    doOcr: envVars.DOCLING_DO_OCR as boolean,
  },
  kbIngestion: {
    queuePriority: envVars.KB_INGESTION_QUEUE_PRIORITY as number,
    ocrPriority: envVars.KB_INGESTION_OCR_PRIORITY as number,
    attachmentOcrPriority: envVars.ATTACHMENT_OCR_PRIORITY as number,
  },
  fileNameOnlyFeed: {
    enabled: envVars.FILE_NAME_ONLY_FEED_ENABLED as boolean,
    queuePriority: envVars.FILE_NAME_ONLY_FEED_PRIORITY as number,
  },
  doclingScheduler: {
    enabled: envVars.DOCLING_ASYNC_SCHEDULER_ENABLED as boolean,
    routePdfs: envVars.DOCLING_ROUTE_PDFS_TO_SCHEDULER as boolean,
    role: envVars.DOCLING_SCHEDULER_ROLE as string,
    pollMs: envVars.DOCLING_SCHEDULER_POLL_MS as number,
    leaseMs: envVars.DOCLING_SCHEDULER_LEASE_MS as number,
    splitConcurrency: envVars.DOCLING_SCHEDULER_SPLIT_CONCURRENCY as number,
    maxSplitAttempts: envVars.DOCLING_SCHEDULER_MAX_SPLIT_ATTEMPTS as number,
    activeOcrFiles: envVars.DOCLING_SCHEDULER_ACTIVE_OCR_FILES as number,
    admittedPageBudget: envVars.DOCLING_SCHEDULER_ADMITTED_PAGE_BUDGET as number,
    perFileInflightParts: envVars.DOCLING_SCHEDULER_PER_FILE_INFLIGHT_PARTS as number,
    perFileInflightPages: envVars.DOCLING_SCHEDULER_PER_FILE_INFLIGHT_PAGES as number,
    maxPartAttempts: envVars.DOCLING_SCHEDULER_MAX_PART_ATTEMPTS as number,
    maxWriteAttempts: envVars.DOCLING_SCHEDULER_MAX_WRITE_ATTEMPTS as number,
    submitConcurrency: envVars.DOCLING_SCHEDULER_SUBMIT_CONCURRENCY as number,
    submitClaimBatchSize: envVars.DOCLING_SCHEDULER_SUBMIT_CLAIM_BATCH_SIZE as number,
    submitPrefetchMultiplier: envVars.DOCLING_SCHEDULER_SUBMIT_PREFETCH_MULTIPLIER as number,
    maxConcurrentClaimers: envVars.DOCLING_SCHEDULER_MAX_CONCURRENT_CLAIMERS as number,
    submitterShutdownDrainMs: envVars.DOCLING_SCHEDULER_SUBMITTER_SHUTDOWN_DRAIN_MS as number,
    admissionPollMs: envVars.DOCLING_SCHEDULER_ADMISSION_POLL_MS as number,
    permitReconcileBatch: envVars.DOCLING_SCHEDULER_PERMIT_RECONCILE_BATCH as number,
    retryBaseMs: envVars.DOCLING_SCHEDULER_RETRY_BASE_MS as number,
    retryMaxMs: envVars.DOCLING_SCHEDULER_RETRY_MAX_MS as number,
    vespaWritePermits: envVars.DOCLING_SCHEDULER_VESPA_WRITE_PERMITS as number,
    vespaWritePermitTtlMs: envVars.DOCLING_SCHEDULER_VESPA_WRITE_PERMIT_TTL_MS as number,
    vespaWriteTimeoutMs: envVars.DOCLING_SCHEDULER_VESPA_WRITE_TIMEOUT_MS as number,
    maxVespaPayloadBytes: envVars.DOCLING_SCHEDULER_MAX_VESPA_PAYLOAD_BYTES as number,
    pageChunkSize: envVars.DOCLING_PAGE_CHUNK_SIZE as number,
    storageRoot: envVars.DOCLING_ASYNC_STORAGE_ROOT as string,
    keepTempResults: envVars.DOCLING_KEEP_TEMP_RESULTS as boolean,
    submitPermits: envVars.DOCLING_ASYNC_SUBMIT_PERMITS as number,
    submitPermitLeaseTtlMs: envVars.DOCLING_ASYNC_SUBMIT_PERMIT_LEASE_TTL_MS as number,
    resultsStream: envVars.DOCLING_RESULTS_STREAM as string,
    resultKeyPrefix: envVars.DOCLING_RESULT_KEY_PREFIX as string,
    resultGroup: envVars.DOCLING_SCHEDULER_RESULT_GROUP as string,
    resultReadCount: envVars.DOCLING_RESULT_READ_COUNT as number,
    resultBlockMs: envVars.DOCLING_RESULT_BLOCK_MS as number,
    resultMinIdleMs: envVars.DOCLING_RESULT_MIN_IDLE_MS as number,
    runtimeConfigKey: envVars.DOCLING_RUNTIME_CONFIG_KEY as string,
    runtimeConfigPollMs: envVars.DOCLING_RUNTIME_CONFIG_POLL_MS as number,
    serviceUrl: envVars.DOCLING_SERVICE_URL as string,
    submitRetries: envVars.DOCLING_ASYNC_SUBMIT_RETRIES as number,
    submitRetryDelayMs: envVars.DOCLING_ASYNC_SUBMIT_RETRY_DELAY_MS as number,
    submitTimeoutMs: envVars.DOCLING_ASYNC_SUBMIT_TIMEOUT_MS as number,
  },
  pdf: {
    maxPdfPageCount: envVars.MAX_PDF_PAGE_COUNT as number,
    disableFallbacks: envVars.PDF_PROCESSING_DISABLE_FALLBACKS as boolean,
    asyncSyncFallbackEnabled: envVars.PDF_ASYNC_SYNC_FALLBACK_ENABLED as boolean,
    // LightOnOCR synchronous fallback engine. Active only when a URL is set
    // (points at the wrapper's /process). The Mode B OCR step.
    lightOnOcr: {
      url: envVars.PDF_LIGHTONOCR_SYNC_URL as string,
      timeoutMs: envVars.PDF_LIGHTONOCR_SYNC_TIMEOUT_MS as number,
      enabled: Boolean(envVars.PDF_LIGHTONOCR_SYNC_URL),
    },
  },
  redis: {
    host: envVars.REDIS_HOST as string,
    port: envVars.REDIS_PORT as number,
    password: envVars.REDIS_PASSWORD as string,
    tls: envVars.REDIS_TLS as boolean,
  },
  dataSource: {
    ingestTableLimit: envVars.DATA_SOURCE_INGEST_TABLE_LIMIT as number,
    edaConcurrency: envVars.DATA_SOURCE_EDA_CONCURRENCY as number,
    allowPrivateHosts: envVars.DATA_SOURCE_ALLOW_PRIVATE_HOSTS as boolean,
  },
};
