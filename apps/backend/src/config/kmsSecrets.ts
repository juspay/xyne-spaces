import { KeyManagementServiceClient } from '@google-cloud/kms';

// Env vars that hold GCP KMS ciphertext (base64) whenever SECRETS_KMS_KEY_NAME is set.
// Decrypted once at startup by loadKmsSecrets(); the plaintext is kept here and merged
// into config by env.ts, never written back to process.env (child processes inherit it).
// To produce a value:
//   printf '%s' "$VALUE" | gcloud kms encrypt --key=<key> --keyring=<ring> --location=<loc> \
//     --project=<project> --plaintext-file=- --ciphertext-file=- | base64
export const KMS_ENCRYPTED_KEYS = [
  'ACTIVITY_CLASSIFICATION_LITELLM_API_KEY',
  'API_KEY',
  'API_SUPPORT_CSAT_API_KEY',
  'APNS_P8_BASE64',
  'ASK_AI_LITELLM_API_KEY',
  'BITBUCKET_AUTH',
  'CALL_LITELLM_API_KEY',
  'COMMON_DATABASE_URL',
  'DATABASE_READ_REPLICA_POOL_URL',
  'DATABASE_URL',
  'ENC_S2S_KEY',
  'ENCRYPTION_KEY',
  'FCM_SERVICE_ACCOUNT_BASE64',
  'GENIUS_API_KEY',
  'GENIUS_UPI_ANALYTICS_API_KEY',
  'GITHUB_TOKEN',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_CLIENT_SECRET_NEW',
  'GOOGLE_MOBILE_CLIENT_SECRET',
  'GOOGLE_PUBSUB_SERVICE_ACCOUNT_BASE64',
  'GOOGLE_REFRESH_TOKEN',
  'INTERNAL_S2S_KEY',
  'INTERNAL_SERVICE_SECRET',
  'JENKINS_API_TOKEN',
  'JENKINS_WEBHOOK_SECRET',
  'JEV_API_KEY',
  'JWT_SECRET',
  'LANGFUSE_SECRET_KEY',
  'LITELLM_API_KEY',
  'LIVEKIT_API_KEY',
  'LIVEKIT_API_SECRET',
  'META_APP_SECRET',
  'META_IG_APP_SECRET',
  'META_WEBHOOK_VERIFY_TOKEN',
  'METTLE_TOKEN',
  'METTLE_USER_SYNC_API_KEY',
  'MICROSOFT_CLIENT_SECRET',
  'OPENAI_API_KEY',
  'OUTAGE_VERIFICATION_AUTH_KEY',
  'PULSE_AUTHORIZATION',
  'QUERY_ROUTING_KEY',
  'REDIS_PASSWORD',
  'RESEARCH_AGENT_API_KEY',
  'SAM_API_KEY',
  'SCM_WEBHOOK_SECRET',
  'SLACK_BOT_TOKEN',
  'SLACK_SIGNING_SECRET',
  'SUDO_QUERY_TOKEN',
  'SUPERPOSITION_TOKEN',
  'TEAM_INTELLIGENCE_SYNC_API_KEY',
  'TRANSCRIPTION_AGENT_API_KEY',
  'USER_DEACTIVATION_SERVICE_SECRET',
  'XOR_API_KEY',
  'XYNE_API_KEY',
  'XYNE_CLAW_S2S_KEY',
  'Y_SWEET_SERVER_TOKEN',
  'ZERO_UPSTREAM_DB',
] as const;

let decrypted: Record<string, string> | null = null;

export function isKmsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.SECRETS_KMS_KEY_NAME?.trim());
}

export async function loadKmsSecrets(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (!isKmsEnabled(env)) {
    decrypted = {};
    return;
  }
  const keyName = env.SECRETS_KMS_KEY_NAME!.trim();
  const kms = new KeyManagementServiceClient();
  const entries = await Promise.all(
    KMS_ENCRYPTED_KEYS.filter((key) => env[key]).map(async (key) => {
      try {
        const [result] = await kms.decrypt({ name: keyName, ciphertext: Buffer.from(env[key]!, 'base64') });
        return [key, Buffer.from(result.plaintext as Uint8Array).toString('utf8').trim()] as const;
      } catch (error) {
        throw new Error(`KMS decryption failed for ${key}: ${(error as Error).message}`);
      }
    })
  );
  decrypted = Object.fromEntries(entries);
}

export function getKmsSecrets(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  if (decrypted) return decrypted;
  if (isKmsEnabled(env)) {
    throw new Error('SECRETS_KMS_KEY_NAME is set but KMS secrets were not loaded; start via src/main.ts or src/main-worker.ts');
  }
  return {};
}
