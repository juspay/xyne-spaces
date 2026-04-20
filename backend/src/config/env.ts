import dotenv from 'dotenv';
import Joi from 'joi';

dotenv.config();

const envSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  RESEARCH_AGENT_URL: Joi.string().default(''),
  // Python transcription agent (health server also exposes /embed-voice)
  PYTHON_AGENT_URL: Joi.string().default(''),
  NX_GRAPH_SERVER_URL: Joi.string().default(''),
  NX_GRAPH_SERVER_URLS: Joi.string().default(''),
  RESEARCH_AGENT_API_KEY: Joi.string().default(''),
  USE_MOCK_ANALYSIS: Joi.boolean().default(false),
  USE_MOCK_BUILD: Joi.boolean().default(false),
  PORT: Joi.number().default(3001),
  HOST: Joi.string().default(''),
  CORS_ORIGIN: Joi.string().default(''),
  ALLOWED_MEDIA_ORIGINS: Joi.string().default(''),
  RATE_LIMIT_WINDOW_MS: Joi.number().default(900000),
  RATE_LIMIT_MAX_REQUESTS: Joi.number().default(100),
  LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'debug').default('info'),
  LOG_FILE_PATH: Joi.string().default(''),
  LOG_USER_SESSION_CHANGES: Joi.boolean().default(true),
  DATABASE_URL: Joi.string().required(),
  DATABASE_READ_REPLICA_POOL_URL: Joi.string().optional().default(''),
  WORKFLOW_LOCK_DURATION_MS: Joi.number().default(3600000), // 30 minutes in milliseconds
  API_KEYS_ENABLED: Joi.boolean().default(false),
  API_KEYS_CONFIG: Joi.string().default(''),
  GOOGLE_CLIENT_ID: Joi.string().allow('').default(''),
  GOOGLE_CLIENT_SECRET: Joi.string().allow('').default(''),
  JWT_SECRET: Joi.string().required(),
  JWT_EXPIRATION_SECONDS: Joi.number().default(86400), // 24 hours in seconds
  SESSION_EXPIRY_DAYS: Joi.number().default(365), // Session cookie expiry in days (default 1 year)
  // File Storage Configuration
  STORAGE_PROVIDER: Joi.string().valid('gcs', 'local', 's3').default('gcs'),
  // AWS S3 Configuration
  AWS_REGION: Joi.string().default(''),
  AWS_ACCESS_KEY_ID: Joi.string().allow('').default(''),
  AWS_SECRET_ACCESS_KEY: Joi.string().allow('').default(''),
  S3_BUCKET_NAME: Joi.string().allow('').default(''),
  S3_ENDPOINT: Joi.string().allow('').default(''), // for MinIO/LocalStack in dev
  // Google Cloud Storage Configuration (Workload Identity)
  GCS_PROJECT_ID: Joi.string().default(''),
  GCS_BUCKET_NAME: Joi.string().default(''),
  GCS_BUNDLE_BUCKET_NAME: Joi.string().default(''),
  GCS_CANVAS_BUCKET_NAME: Joi.string().default(''),
  GCS_DOCS_BUCKET_NAME: Joi.string().default(''),
  GCS_MAX_FILE_SIZE_MB: Joi.number().default(1024),
  FAKE_GCS_HOST: Joi.string().default(''),
  TRANSCRIPTION_BUCKET_NAME: Joi.string().default(''),
  GCS_WORKFLOW_STEPS_BUCKET_NAME: Joi.string().default(''),
  GCS_SESSION_RECORDING_BUCKET_NAME: Joi.string().default(''),
  GCS_WORKFLOW_VR_BUCKET_NAME: Joi.string().default(''),
  ENABLE_WORKFLOW_STEP_GCS_SYNC: Joi.boolean().default(false),
  ENABLE_CONVERSATION_INGESTION_QUEUE: Joi.boolean().default(false),
  ENABLE_CONVERSATION_INGESTION_WORKER: Joi.boolean().default(false),
  ENABLE_SCHEDULED_MESSAGE_WORKER: Joi.boolean().default(false),
  BACKEND_URL: Joi.string().default(''),
  SLACK_BOT_TOKEN: Joi.string().allow('').default(''),
  SLACK_FRONTEND_URL: Joi.string().allow('').default(''),
  SLACK_SIGNING_SECRET: Joi.string().allow('').default(''), // Slack signing secret for request verification
  SLACK_MIGRATION_APPROVALS: Joi.string().allow('').default(''), // Comma-separated list of approved Slack user IDs
  SLACK_IGNORED_BOT_IDS: Joi.string().allow('').default(''), // Comma-separated list of bot IDs to exclude from migration
  SLACK_MIGRATION_FINAL_MESSAGE: Joi.string().allow('').default(''), // Custom message appended to the final migration notification
  // Zoho Integration
  ZOHO_AUTO_WORKFLOW_ENABLED: Joi.boolean().default(true),
  // SAM Service Configuration
  SAM_BASE_URL: Joi.string().uri().default(''),
  SAM_API_KEY: Joi.string().allow('').default(''),
  // LiveKit Configuration
  LIVEKIT_API_KEY: Joi.string().default(''),
  LIVEKIT_API_SECRET: Joi.string().default(''),
  LIVEKIT_URL: Joi.string().default(''),
  LIVEKIT_CLIENT_URL: Joi.string().default(''),
  LIVEKIT_SERVER_URL: Joi.string().default(''),
  FCM_PROJECT_ID: Joi.string().allow('').default(''),
  FCM_SERVICE_ACCOUNT_BASE64: Joi.string().allow('').default(''),
  APNS_KEY_ID: Joi.string().allow('').default(''),
  APNS_TEAM_ID: Joi.string().allow('').default(''),
  APNS_BUNDLE_ID: Joi.string().allow('').default(''),
  APNS_P8_BASE64: Joi.string().allow('').default(''),
  // Y-Sweet Configuration
  Y_SWEET_URL: Joi.string().default(''),
  // LiteLLM Configuration for AI Agents
  LITELLM_BASE_URL: Joi.string().default(''),
  LITELLM_API_KEY: Joi.string().allow('').default(''),
  ASK_AI_LITELLM_API_KEY: Joi.string().allow('').default(''),
  ACTIVITY_CLASSIFICATION_LITELLM_API_KEY: Joi.string().allow('').default(''),
  // LiteLLM config specifically for call features (transcript summary, PRD, detailed summary)
  CALL_LITELLM_API_KEY: Joi.string().allow('').default(''),
  CALL_LITELLM_MODEL: Joi.string().default(''),
  ACTIVITY_CLASSIFICATION_MODEL: Joi.string().default(''),
  PRODUCT_INSIGHTS_RECLUSTER_CRON: Joi.string().default(''),
  PRODUCT_INSIGHTS_RECLUSTER_WINDOW_DAYS: Joi.number().default(30),
  // Working Hours Configuration (in IST)
  WORKING_HOUR_START: Joi.number().default(11),
  WORKING_HOUR_END: Joi.number().default(19),
  ENABLE_NOTIFICATION_WORKER: Joi.boolean().default(false),
  ENABLE_TICKET_CLEANUP_WORKER: Joi.boolean().default(false),
  ENABLE_WORKER_SCHEDULER: Joi.boolean().default(true),
  ENABLE_RECAP_SCHEDULER: Joi.boolean().default(true),
  RECAP_GENERATION_CRON: Joi.string().default(''), //5:45 IST daily
  RECAP_CLEANUP_CRON: Joi.string().default(''), //5:00 IST daily
  RECAP_RETENTION_DAYS: Joi.number().default(30),
  ACTIVITY_CLASSIFICATION_MAX_RETRIES: Joi.number().default(2),
  TICKET_DESC_CLEAN_MODEL: Joi.string().default(''),
  TICKET_DESC_CLEAN_MAX_RETRIES: Joi.number().default(3),
  LLM_REQUEST_TIMEOUT_MS: Joi.number().default(120000),
  LANGFUSE_SECRET_KEY: Joi.string().allow('').default(''),
  LANGFUSE_PUBLIC_KEY: Joi.string().allow('').default(''),
  LANGFUSE_BASE_URL: Joi.string().allow('').default(''),
  MESSAGE_CLASSIFIER_URL: Joi.string().uri().default(''),
  MESSAGE_CLASSIFIER_TIMEOUT_MS: Joi.number().default(5000),
  // Genius Bot API Configuration
  GENIUS_API_URL: Joi.string().uri().default(''),
  GENIUS_API_KEY: Joi.string().allow('').default(''),
  QUERY_ROUTING_KEY: Joi.string().allow('').default(''),
  // UPI Analytics Bot API Configuration
  GENIUS_UPI_ANALYTICS_API_URL: Joi.string().uri().default(''),
  GENIUS_UPI_ANALYTICS_API_KEY: Joi.string().allow('').default(''),
  GENIUS_UPI_ANALYTICS_USERNAME: Joi.string().allow('').default(''),
  // Xyne Investigation API Configuration
  XYNE_API_KEY: Joi.string().allow('').default(''),
  // Transcription Agent API Key (for S2S authentication)
  TRANSCRIPTION_AGENT_API_KEY: Joi.string().default(''),
  // Superposition Configuration
  SUPERPOSITION_ENDPOINT: Joi.string().uri().default(''),
  SUPERPOSITION_TOKEN: Joi.string().allow('').default(''),
  SUPERPOSITION_ORG_ID: Joi.string().allow('').default(''),
  SUPERPOSITION_WORKSPACE_ID: Joi.string().allow('').default(''),
  SUPERPOSITION_POLLING_INTERVAL: Joi.number().default(60000), // 60 seconds in milliseconds
  SUPERPOSITION_TIMEOUT: Joi.number().default(30000), // 30 seconds in milliseconds
  // Jenkins Configuration
  JENKINS_BASE_URL: Joi.string()
    .uri()
    .default(''),
  JENKINS_JOB_PATH: Joi.string().default(''),
  JENKINS_USERNAME: Joi.string().allow('').default(''),
  JENKINS_API_TOKEN: Joi.string().allow('').default(''),
  // OpenCode Configuration
  OPENCODE_ENABLED: Joi.boolean().default(false),
  OPENCODE_SPAWN_SERVER: Joi.boolean().default(false),
  OPENCODE_BASE_URL: Joi.string().uri().default(''),
  OPENCODE_TIMEOUT_MS: Joi.number().default(600000),
  OPENCODE_AUTO_COMPACT: Joi.boolean().default(false),
  OPENCODE_MODEL: Joi.string().allow('').default(''),
  QUESTION_TIMEOUT_MINUTES: Joi.number().default(2),
  // Default workflow executor when not specified
  DEFAULT_WORKFLOW_EXECUTOR: Joi.string().default(''),
  // Default model ID for config sync service
  DEFAULT_MODEL_ID: Joi.string().default(''),
  DEFAULT_MODEL_NAME: Joi.string().default(''),
  // oh-my-opencode Plugin Configuration
  OPENCODE_PLUGIN_ENABLED: Joi.boolean().default(true),
  OPENCODE_PLUGIN_VERSION: Joi.string().allow('').default(''),
  // Xyne AI Extended (web search, mem0, deep research, etc.)
  XYNE_AI_EXTENDED_URL: Joi.string().uri().allow('').default(''),
  ENABLE_WORKFLOW_RECOVERY: Joi.boolean().default(true),
  // Otel Configuration
  OTEL_BASE_URL: Joi.string().default(''),
  OTEL_SERVICE_NAME: Joi.string().default(''),
  OTEL_EXPORT_INTERVAL_MS: Joi.number().default(60000),
  SCM_WEBHOOK_SECRET: Joi.string().default(''),
  BITBUCKET_AUTH: Joi.string().allow('').default(''),
  BITBUCKET_SSH_BASE_URL: Joi.string().allow('').default(''),
  // Bitbucket Configuration
  BITBUCKET_BASE_URL: Joi.string()
    .allow('')
    .default(''),
  BITBUCKET_USERNAME: Joi.string().allow('').default(''),
  BITBUCKET_PASSWORD: Joi.string().allow('').default(''),
  BITBUCKET_TOKEN: Joi.string().allow('').default(''),
  JENKINS_WEBHOOK_SECRET: Joi.string().allow('').default(''),
  GITHUB_TOKEN: Joi.string().allow('').default(''),
  GITHUB_API_URL: Joi.string().uri().default(''),
  //Presence Queue Configuration
  PRESENCE_CLEANUP_INTERVAL_MS: Joi.number().default(600000),
  PRESENCE_OFFLINE_GRACE_PERIOD_MS: Joi.number().default(300000),
  // Pulse Integration
  PULSE_ENABLED_CHANNELS: Joi.string().allow('').default(''),
  PULSE_API_URL: Joi.string().uri().default(''),
  PULSE_AUTHORIZATION: Joi.string().allow('').default(''),
  // Grafana Configuration (for Inspector Tools log querying)
  GRAFANA_URL: Joi.string().allow('').default(''),
  GRAFANA_TOKEN: Joi.string().allow('').default(''),
  GRAFANA_LOGS_DATASOURCE_ID: Joi.string().default(''),
  // Jira Configuration
  JUSPAY_JIRA_BASEURL: Joi.string().uri().default(''),
  JIRA_EULER_BOT_EMAIL: Joi.string().allow('').default(''),
  JIRA_EULER_BOT_AUTH_TOKEN: Joi.string().allow('').default(''),
  JIRA_MIGRATION_BOT_EMAIL: Joi.string().allow('').default(''),
  JIRA_MIGRATION_BOT_AUTH_TOKEN: Joi.string().allow('').default(''),
  // Bit-Bot Integration
  ENABLE_FILE_INDEXING: Joi.boolean().default(false),
}).unknown();

const { error, value: envVars } = envSchema.validate(process.env);

if (error) {
  throw new Error(`Config validation error: ${error.message}`);
}

export const config = {
  env: envVars.NODE_ENV,
  isTestEnv: envVars.NODE_ENV === 'test',
  research_agent_url: envVars.RESEARCH_AGENT_URL,
  pythonAgentUrl: envVars.PYTHON_AGENT_URL as string,
  nx_graph_server_url: envVars.NX_GRAPH_SERVER_URL,
  nx_graph_server_urls: envVars.NX_GRAPH_SERVER_URLS
    ? envVars.NX_GRAPH_SERVER_URLS.split(',').map((url: string) => url.trim())
    : [envVars.NX_GRAPH_SERVER_URL],
  research_agent_api_key: envVars.RESEARCH_AGENT_API_KEY,
  use_mock_analysis: envVars.USE_MOCK_ANALYSIS,
  use_mock_build: envVars.USE_MOCK_BUILD,
  port: envVars.PORT,
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
    filePath: envVars.LOG_FILE_PATH,
    logUserSessionChanges: envVars.LOG_USER_SESSION_CHANGES,
  },
  database: {
    url: envVars.DATABASE_URL,
    readReplicaPoolUrl: envVars.DATABASE_READ_REPLICA_POOL_URL,
  },
  workflow: {
    lockDurationMs: envVars.WORKFLOW_LOCK_DURATION_MS,
    defaultExecutor: envVars.DEFAULT_WORKFLOW_EXECUTOR,
    defaultModelId: envVars.DEFAULT_MODEL_ID,
    defaultModelName: envVars.DEFAULT_MODEL_NAME,
  },
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
    // Call-specific LiteLLM config (falls back to main litellm if not set)
    callLitellmApiKey: envVars.CALL_LITELLM_API_KEY || envVars.LITELLM_API_KEY,
    callLitellmModel: envVars.CALL_LITELLM_MODEL,
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
  gcs: {
    projectId: envVars.GCS_PROJECT_ID,
    bucketName: envVars.GCS_BUCKET_NAME,
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
  backendUrl: envVars.BACKEND_URL,
  slackBotToken: envVars.SLACK_BOT_TOKEN,
  slackFrontendUrl: envVars.SLACK_FRONTEND_URL,
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
  slackMigrationFinalMessage: envVars.SLACK_MIGRATION_FINAL_MESSAGE,
  zoho: {
    autoWorkflowEnabled: envVars.ZOHO_AUTO_WORKFLOW_ENABLED,
  },
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
  fcm: {
    projectId: envVars.FCM_PROJECT_ID,
    serviceAccountBase64: envVars.FCM_SERVICE_ACCOUNT_BASE64,
  },
  apns: {
    keyId: envVars.APNS_KEY_ID,
    teamId: envVars.APNS_TEAM_ID,
    bundleId: envVars.APNS_BUNDLE_ID,
    p8Base64: envVars.APNS_P8_BASE64,
  },
  ysweet: {
    url: envVars.Y_SWEET_URL,
  },
  litellm: {
    baseUrl: envVars.LITELLM_BASE_URL,
    apiKey: envVars.LITELLM_API_KEY,
    askAiApiKey: envVars.ASK_AI_LITELLM_API_KEY || envVars.LITELLM_API_KEY,
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
  geniusUpiAnalytics: {
    apiUrl: envVars.GENIUS_UPI_ANALYTICS_API_URL,
    apiKey: envVars.GENIUS_UPI_ANALYTICS_API_KEY,
    username: envVars.GENIUS_UPI_ANALYTICS_USERNAME,
  },
  xyne: {
    apiKey: envVars.XYNE_API_KEY,
  },
  transcriptionAgentApiKey: envVars.TRANSCRIPTION_AGENT_API_KEY,
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
  ticketCleanupWorkerEnabled: envVars.ENABLE_TICKET_CLEANUP_WORKER,
  notificationWorkerEnabled: envVars.ENABLE_NOTIFICATION_WORKER,
  runWorkerInBackend: envVars.RUN_WORKER_IN_BACKEND,
  recapScheduler: {
    enabled: envVars.ENABLE_RECAP_SCHEDULER,
    generationCron: envVars.RECAP_GENERATION_CRON,
    cleanupCron: envVars.RECAP_CLEANUP_CRON,
    retentionDays: envVars.RECAP_RETENTION_DAYS,
  },
  otel: {
    baseUrl: envVars.OTEL_BASE_URL,
    serviceName: envVars.OTEL_SERVICE_NAME,
    exportIntervalMs: envVars.OTEL_EXPORT_INTERVAL_MS,
  },
  xyneAiExtended: {
    url: envVars.XYNE_AI_EXTENDED_URL,
  },
  jwt: {
    expirationSeconds: envVars.JWT_EXPIRATION_SECONDS,
  },
  session: {
    expiryDays: envVars.SESSION_EXPIRY_DAYS,
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
  grafana: {
    url: envVars.GRAFANA_URL as string,
    token: envVars.GRAFANA_TOKEN as string,
    logsDatasourceId: envVars.GRAFANA_LOGS_DATASOURCE_ID as string,
  },
  jira: {
    baseUrl: envVars.JUSPAY_JIRA_BASEURL as string,
    eulerBotEmail: envVars.JIRA_EULER_BOT_EMAIL as string,
    eulerBotAuthToken: envVars.JIRA_EULER_BOT_AUTH_TOKEN as string,
    migrationBotEmail: envVars.JIRA_MIGRATION_BOT_EMAIL as string,
    migrationBotAuthToken: envVars.JIRA_MIGRATION_BOT_AUTH_TOKEN as string,
  },
  enableFileIndexing: envVars.ENABLE_FILE_INDEXING as boolean,
};
