export const gatewayConfig = {
  lockTtlSeconds: 120,
  maxFileBytes: 50 * 1024 * 1024,
  fileTimeoutMs: 120_000,
  jobConcurrency: 10,
} as const;
