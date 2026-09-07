import type { JsonValue } from '@openfeature/server-sdk';
import { superpositionClient } from '@/services/superpositionClient';

/** The one Superposition key holding the whole JSON blob. */
export const SLACK_SELF_SERVICE_CONFIG_KEY = 'SlackSelfService';

export interface MigrationRuntimeConfig {
  bulk: boolean;            // bulk createMany path vs the per-message path
  bulkBatchSize: number;   // rows per createMany in the bulk path
  messageDelayMs: number;  // pause between messages at ingest (0 = unpaced)
  fileConcurrency: number; // attachments streamed Slack→GCS in parallel during collection
  pageDelayMs: number;     // pause between paged Slack history calls (collection)
  listDelayMs: number;     // pause between Tier-2 list pages (conversations.list/users.list)
  fileTimeoutMs: number;   // per-attachment download timeout
  requestTimeoutMs: number;// per Slack API request timeout
  stallLimitMs: number;    // live heartbeat but no forward progress ⇒ worker wedged
}

/** Defaults used for any field the Superposition key doesn't set (and when the key is empty/unreachable). */
export const MIGRATION_DEFAULTS: MigrationRuntimeConfig = {
  bulk: false,
  bulkBatchSize: 500,
  messageDelayMs: 0,
  fileConcurrency: 5,
  pageDelayMs: 250,
  listDelayMs: 3000,
  fileTimeoutMs: 600_000,
  requestTimeoutMs: 30_000,
  stallLimitMs: 600_000,
};

/** Read the JSON key and overlay any provided fields onto the defaults. */
export async function getMigrationRuntimeConfig(): Promise<MigrationRuntimeConfig> {
  const raw = await superpositionClient.getObjectValue(SLACK_SELF_SERVICE_CONFIG_KEY, MIGRATION_DEFAULTS as unknown as JsonValue);
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? { ...MIGRATION_DEFAULTS, ...(raw as Partial<MigrationRuntimeConfig>) }
    : MIGRATION_DEFAULTS;
}
