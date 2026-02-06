import dotenv from 'dotenv';
import Joi from 'joi';

dotenv.config();

const envSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  RESEARCH_AGENT_URL: Joi.string().default(''),
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
  DATABASE_URL: Joi.string().required(),
  WORKFLOW_LOCK_DURATION_MS: Joi.number().default(3600000), // 30 minutes in milliseconds
  API_KEYS_ENABLED: Joi.boolean().default(false),
  API_KEYS_CONFIG: Joi.string().default(''),
  GOOGLE_CLIENT_ID: Joi.string().allow('').default(''),
  GOOGLE_CLIENT_SECRET: Joi.string().allow('').default(''),
  JWT_SECRET: Joi.string().required(),
  // File Storage Configuration
  STORAGE_PROVIDER: Joi.string().valid('gcs', 'local', 's3').default('gcs'),
  // Google Cloud Storage Configuration (Workload Identity)
  GCS_PROJECT_ID: Joi.string().default(''),
  GCS_BUCKET_NAME: Joi.string().default(''),
  GCS_BUNDLE_BUCKET_NAME: Joi.string().default(''),
  GCS_CANVAS_BUCKET_NAME: Joi.string().default(''),
  GCS_DOCS_BUCKET_NAME: Joi.string().default(''),
  GCS_MAX_FILE_SIZE_MB: Joi.number().default(1024),
  FAKE_GCS_HOST: Joi.string().default(''),
  TRANSCRIPTION_BUCKET_NAME: Joi.string().default(''),
  SLACK_BOT_TOKEN: Joi.string().allow('').default(''),
  SLACK_FRONTEND_URL: Joi.string().allow('').default(''),
  SLACK_SIGNING_SECRET: Joi.string().allow('').default(''), // Slack signing secret for request verification
  SLACK_MIGRATION_APPROVALS: Joi.string().allow('').default(''), // Comma-separated list of approved Slack user IDs
  // Zoho Integration
  ZOHO_AUTO_WORKFLOW_ENABLED: Joi.boolean().default(true),
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
  ACTIVITY_CLASSIFICATION_MODEL: Joi.string().default(''),
  // Working Hours Configuration (in IST)
  WORKING_HOUR_START: Joi.number().default(11),
  WORKING_HOUR_END: Joi.number().default(19),
  ENABLE_NOTIFICATION_WORKER: Joi.boolean().default(false),
  ACTIVITY_CLASSIFICATION_MAX_RETRIES: Joi.number().default(2),
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
  JENKINS_BASE_URL: Joi.string().uri().default(''),
  JENKINS_JOB_PATH: Joi.string().default(''),
  JENKINS_USERNAME: Joi.string().allow('').default(''),
  JENKINS_API_TOKEN: Joi.string().allow('').default(''),
  // OpenCode Configuration
  OPENCODE_ENABLED: Joi.boolean().default(true),
  OPENCODE_SPAWN_SERVER: Joi.boolean().default(true),
  OPENCODE_BASE_URL: Joi.string().uri().default(''),
  OPENCODE_TIMEOUT_MS: Joi.number().default(600000),
  OPENCODE_AUTO_COMPACT: Joi.boolean().default(true),
  OPENCODE_MODEL: Joi.string().allow('').default(''),
  // oh-my-opencode Plugin Configuration
  OPENCODE_PLUGIN_ENABLED: Joi.boolean().default(true),
  OPENCODE_PLUGIN_VERSION: Joi.string().allow('').default(''),
  // Web Search Configuration
  WEB_SEARCH_URL: Joi.string().uri().allow('').default(''),
  WEB_SEARCH_API_KEY: Joi.string().allow('').default(''),
  // Otel Configuration
  OTEL_BASE_URL: Joi.string().default(''),
  OTEL_SERVICE_NAME: Joi.string().default(''),
  OTEL_EXPORT_INTERVAL_MS: Joi.number().default(60000),
  BITBUCKET_WEBHOOK_SECRET: Joi.string().default(''),
  BITBUCKET_AUTH: Joi.string().allow('').default(''),
  BITBUCKET_USERNAME: Joi.string().allow('').default(''),
  BITBUCKET_SSH_BASE_URL: Joi.string().allow('').default(''),
}).unknown();

const { error, value: envVars } = envSchema.validate(process.env);

if (error) {
  throw new Error(`Config validation error: ${error.message}`);
}

export const config = {
  env: envVars.NODE_ENV,
  isTestEnv: envVars.NODE_ENV === 'test',
  research_agent_url: envVars.RESEARCH_AGENT_URL,
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
  },
  database: {
    url: envVars.DATABASE_URL,
  },
  workflow: {
    lockDurationMs: envVars.WORKFLOW_LOCK_DURATION_MS,
  },
  fileStorage: {
    provider: envVars.STORAGE_PROVIDER,
  },
  llm: {
    litellmApiKey: envVars.LITELLM_API_KEY,
    litellmBaseUrl: envVars.LITELLM_BASE_URL,
    litellmModel: envVars.ACTIVITY_CLASSIFICATION_MODEL,
    requestTimeoutMs: envVars.LLM_REQUEST_TIMEOUT_MS,
  },
  activityClassification: {
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
    maxFileSizeMB: envVars.GCS_MAX_FILE_SIZE_MB,
    fakeGcsHost: envVars.FAKE_GCS_HOST,
    transcriptionBucketName: envVars.TRANSCRIPTION_BUCKET_NAME,
  },
  slackBotToken: envVars.SLACK_BOT_TOKEN,
  slackFrontendUrl: envVars.SLACK_FRONTEND_URL,
  slackSigningSecret: envVars.SLACK_SIGNING_SECRET,
  slackMigrationApprovals: envVars.SLACK_MIGRATION_APPROVALS
    ? envVars.SLACK_MIGRATION_APPROVALS.split(',')
      .map((id: string) => id.trim())
      .filter(Boolean)
    : [],
  zoho: {
    autoWorkflowEnabled: envVars.ZOHO_AUTO_WORKFLOW_ENABLED,
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
  transcriptionAgentApiKey: envVars.TRANSCRIPTION_AGENT_API_KEY,
  bitbucket: {
    webhookSecret: envVars.BITBUCKET_WEBHOOK_SECRET,
    apiToken: envVars.BITBUCKET_AUTH,
    apiUsername: envVars.BITBUCKET_USERNAME,
    sshBaseUrl: envVars.BITBUCKET_SSH_BASE_URL,
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
  notificationWorkerEnabled: envVars.ENABLE_NOTIFICATION_WORKER,
  otel: {
    baseUrl: envVars.OTEL_BASE_URL,
    serviceName: envVars.OTEL_SERVICE_NAME,
    exportIntervalMs: envVars.OTEL_EXPORT_INTERVAL_MS,
  },
  webSearch: {
    url: envVars.WEB_SEARCH_URL,
    apiKey: envVars.WEB_SEARCH_API_KEY,
  },
};
