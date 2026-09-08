import { z } from 'zod';

const envSchema = z.object({
  STORAGE_BACKEND: z.enum(['gcs', 's3', 'azure', 'http']).default('gcs'),
  STORAGE_BUCKET: z.string().optional(),
  STORAGE_ENDPOINT: z.string().optional(),
  /** sdk: the provider SDK's default credential chain; none: unauthenticated; sas: Azure SAS token. */
  STORAGE_AUTH: z.enum(['sdk', 'none', 'sas']).default('sdk'),
  /** http backend only: static Authorization header value sent to the origin. */
  STORAGE_AUTH_HEADER: z.string().optional(),
  AWS_REGION: z.string().optional(),
  GOOGLE_CLOUD_PROJECT: z.string().optional(),
  AZURE_STORAGE_ACCOUNT: z.string().optional(),
  AZURE_STORAGE_SAS_TOKEN: z.string().optional(),
  EDGE_RULES_FILE: z.string().default('/etc/edge/rules/rules.json'),
  EDGE_RELOAD_INTERVAL: z.coerce.number().positive().default(5),
  EDGE_HEALTH_INTERVAL: z.coerce.number().positive().default(30),
  EDGE_APP_ADDR: z.string().default('127.0.0.1'),
  EDGE_APP_PORT: z.coerce.number().int().positive().default(9101),
  EDGE_SYSLOG_PORT: z.coerce.number().int().positive().default(9102),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type StorageBackend = 'gcs' | 's3' | 'azure' | 'http';
export type StorageAuth = 'sdk' | 'none' | 'sas';

export interface Config {
  storage: {
    backend: StorageBackend;
    bucket: string | undefined;
    endpoint: string | undefined;
    auth: StorageAuth;
    authHeader: string | undefined;
    awsRegion: string | undefined;
    gcpProject: string | undefined;
    azureAccount: string | undefined;
    azureSasToken: string | undefined;
  };
  rulesFile: string;
  reloadIntervalMs: number;
  healthIntervalMs: number;
  listen: { addr: string; port: number };
  syslogPort: number;
  logLevel: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`invalid configuration: ${parsed.error.message}`);
  }
  const e = parsed.data;
  if (e.STORAGE_BACKEND !== 'http' && !e.STORAGE_BUCKET) {
    throw new Error(`STORAGE_BUCKET is required for STORAGE_BACKEND=${e.STORAGE_BACKEND}`);
  }
  if (e.STORAGE_BACKEND === 'http' && !e.STORAGE_ENDPOINT) {
    throw new Error('STORAGE_ENDPOINT is required for STORAGE_BACKEND=http');
  }
  if (e.STORAGE_AUTH === 'sas' && e.STORAGE_BACKEND !== 'azure') {
    throw new Error('STORAGE_AUTH=sas is only valid for STORAGE_BACKEND=azure');
  }
  return {
    storage: {
      backend: e.STORAGE_BACKEND,
      bucket: e.STORAGE_BUCKET,
      endpoint: e.STORAGE_ENDPOINT?.replace(/\/+$/, ''),
      auth: e.STORAGE_AUTH,
      authHeader: e.STORAGE_AUTH_HEADER,
      awsRegion: e.AWS_REGION,
      gcpProject: e.GOOGLE_CLOUD_PROJECT,
      azureAccount: e.AZURE_STORAGE_ACCOUNT,
      azureSasToken: e.AZURE_STORAGE_SAS_TOKEN,
    },
    rulesFile: e.EDGE_RULES_FILE,
    reloadIntervalMs: e.EDGE_RELOAD_INTERVAL * 1000,
    healthIntervalMs: e.EDGE_HEALTH_INTERVAL * 1000,
    listen: { addr: e.EDGE_APP_ADDR, port: e.EDGE_APP_PORT },
    syslogPort: e.EDGE_SYSLOG_PORT,
    logLevel: e.LOG_LEVEL,
  };
}
