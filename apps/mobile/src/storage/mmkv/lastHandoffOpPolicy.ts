export const HANDOFF_LAST_OP_RECENT_MS = 120_000;

export type HandoffEligibility = {
  appState: 'active' | 'inactive' | 'background' | 'unknown';
  runtime: 'main' | 'headless' | 'unknown';
};

export type HandoffLastOpRecord = HandoffEligibility & {
  ts: number;
  op: string;
  caller: string;
  keyHash: string;
};

export function hashMmkvKey(key: string): string {
  let hash = 5381;
  for (let index = 0; index < key.length; index += 1) {
    hash = ((hash << 5) + hash + key.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16);
}

export function isSuspendEligible(record: HandoffEligibility): boolean {
  return record.runtime === 'headless' || record.appState !== 'active';
}

/**
 * Cache-class keys may fall back to App Group only in the foreground main app.
 * Background/headless fallback is the 0xdead10cc class (shared-file lock on read).
 */
export function isSharedStoreFallbackAllowed(record: HandoffEligibility): boolean {
  return !isSuspendEligible(record);
}

export function shouldPublishHandoffLastOp(record: HandoffLastOpRecord, now = Date.now()): boolean {
  return isSuspendEligible(record) && now - record.ts <= HANDOFF_LAST_OP_RECENT_MS;
}
