import dotenv from 'dotenv';
import Joi from 'joi';

dotenv.config();

const envSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  API_PORT: Joi.number().default(3012),
  ZERO_PROXY_PORT: Joi.number().default(3013),
  HOST: Joi.string().default('localhost'),
  LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'debug').default('info'),
  DATABASE_URL: Joi.string().required(),
  JWT_SECRET: Joi.string().required(),
  FORCE_LOGOUT_BEFORE: Joi.number().optional(),
  ENC_S2S_KEY: Joi.string().allow('').default(''),
  ZERO_CACHE_UPSTREAM: Joi.string().default('http://localhost:4848'),
  RSA_PRIVATE_KEY: Joi.string().allow('').default(''),
  RSA_PUBLIC_KEY: Joi.string().allow('').default(''),
  KMS_ENC_PROVIDER: Joi.string().valid('env', 'gcp-kms').allow('').default('env'),
  ENC_ENV_MASTER_KEY_HEX: Joi.string().allow('').default(''),
  GCP_KMS_KEY_RING_REF: Joi.string().allow('').default(''),
  DEK_CACHE_MAX_ENTRIES: Joi.number().integer().min(1).default(1024),
  ENC_WORKSPACE_ORG_CACHE_MAX_ENTRIES: Joi.number().integer().min(1).default(2048),
  ZERO_CLIENT_ENCRYPTION_ENABLED: Joi.boolean().default(false),
  API_CLIENT_ENCRYPTION_ENABLED: Joi.boolean().default(false),
  ENABLE_DB_ENCRYPTION: Joi.boolean().default(false),
}).unknown();

const { error, value } = envSchema.validate(process.env);
if (error) {
  throw new Error(`Encryption config validation error: ${error.message}`);
}

export const config = {
  env: value.NODE_ENV as string,
  apiPort: value.API_PORT as number,
  zeroProxyPort: value.ZERO_PROXY_PORT as number,
  host: value.HOST as string,
  logging: {
    level: value.LOG_LEVEL as string,
  },
  database: {
    url: value.DATABASE_URL as string,
  },
  jwt: {
    secret: value.JWT_SECRET as string,
    forceLogoutBefore: value.FORCE_LOGOUT_BEFORE as number | undefined,
  },
  internal: {
    s2sKey: value.ENC_S2S_KEY as string,
  },
  zeroCacheUpstream: value.ZERO_CACHE_UPSTREAM as string,
  enc: {
    rsaPrivateKey: value.RSA_PRIVATE_KEY as string,
    rsaPublicKey: value.RSA_PUBLIC_KEY as string,
    kmsProvider: value.KMS_ENC_PROVIDER as string,
    envMasterKeyHex: value.ENC_ENV_MASTER_KEY_HEX as string,
    gcpKmsKeyRingRef: value.GCP_KMS_KEY_RING_REF as string,
    dekCacheMaxEntries: value.DEK_CACHE_MAX_ENTRIES as number,
    workspaceOrgCacheMaxEntries: value.ENC_WORKSPACE_ORG_CACHE_MAX_ENTRIES as number,
    clientEncryptionEnabled: value.ZERO_CLIENT_ENCRYPTION_ENABLED as boolean,
    apiClientEncryptionEnabled: value.API_CLIENT_ENCRYPTION_ENABLED as boolean,
    enableDbEncryption: value.ENABLE_DB_ENCRYPTION as boolean,
  },
};
