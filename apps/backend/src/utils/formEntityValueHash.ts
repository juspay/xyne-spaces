import { createHmac } from 'node:crypto';
import { normalizeTextForHash } from '@xyne/shared';
import { config as appConfig } from '@/config/env';

let cachedKey: Buffer | null = null;

// FORM_FIELD_TEXT_HASH_KEY is validated in config/env.ts (64 hex characters, required in
// production). Changing it means recomputing every stored textHash.
function textHashKey(): Buffer {
  cachedKey ??= Buffer.from(appConfig.formFieldTextHashKey, 'hex');
  return cachedKey;
}

/** textHash for a STRING custom-field value: hex HMAC-SHA256 of the lowercased, trimmed text. */
export function formEntityValueTextHash(text: string): string {
  return createHmac('sha256', textHashKey()).update(normalizeTextForHash(text)).digest('hex');
}
