const requiredEnv = (name: string): string => {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env: ${name}`);
  return val;
};

export const CONFIG = {
  port: Number(process.env["AUTH_SERVICE_PORT"] ?? 3003),
  selfUrl: process.env["AUTH_SERVICE_URL"] ?? `http://localhost:${process.env["AUTH_SERVICE_PORT"] ?? 3003}`,
  encryptionKey: Buffer.from(requiredEnv("ENCRYPTION_KEY"), "hex"),
  xyneClawUrl: process.env["XYNE_CLAW_URL"] ?? "http://localhost:3002",
  xyneClawS2sKey: process.env["XYNE_CLAW_S2S_KEY"] ?? "",
  xyneSpacesCallbackUrl: process.env["XYNE_SPACES_CALLBACK_URL"] ?? "",
  spacesBackendUrl: process.env["SPACES_BACKEND_URL"] ?? "http://localhost:3001",
  spacesAppUrl: process.env["SPACES_APP_URL"]
    ?? process.env["VITE_XYNE_BACKEND_URL"]
    ?? process.env["SPACES_BACKEND_URL"]
    ?? "http://localhost:3001",
  defaultAgentSlug: process.env["DEFAULT_AGENT_SLUG"] ?? "assistant",
  minCronIntervalMinutes: Number(process.env["MIN_CRON_INTERVAL_MINUTES"] ?? 30),
  redisHost: process.env["REDIS_HOST"] ?? "localhost",
  redisPort: Number(process.env["REDIS_PORT"] ?? 6379),
  redisPassword: process.env["REDIS_PASSWORD"] || undefined,
  redisTls: process.env["REDIS_TLS"] === "true",
  runRecoveryMaxRetries: Number(process.env["RUN_RECOVERY_MAX_RETRIES"] ?? 3),
  runRecoveryTimeoutMs: Number(process.env["RUN_RECOVERY_TIMEOUT_MS"] ?? 900000),
  runRecoveryBackoffMs: Number(process.env["RUN_RECOVERY_BACKOFF_MS"] ?? 30000),
  gcsProjectId: process.env["GCS_PROJECT_ID"] ?? "",
  gcsBucketName: process.env["GCS_BUCKET_NAME"] ?? "xyne-claw-chat-attachments",
  fakeGcsHost: process.env["FAKE_GCS_HOST"] ?? "",
} as const;
