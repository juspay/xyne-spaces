/**
 * A version mismatch or a corrupt blob is "no warm window", never a partial
 * read (design §5.5 / Ch. 37).
 */

export const EXPECTED_CHAT_CACHE_ENTITY_VERSION = '1';

export type WarmSchemaSnapshot = {
  storedSchemaVersion: string | null;
  expectedSchemaVersion: string | null;
  storedEntityVersion: string | null;
  expectedEntityVersion: string;
};

export const isWarmSchemaCompatible = (snapshot: WarmSchemaSnapshot): boolean => {
  if (snapshot.storedEntityVersion !== snapshot.expectedEntityVersion) {
    return false;
  }
  if (snapshot.storedSchemaVersion === null || snapshot.expectedSchemaVersion === null) {
    return false;
  }
  return snapshot.storedSchemaVersion === snapshot.expectedSchemaVersion;
};

export const decodeWarmEntity = (raw: string | null | undefined): unknown | null => {
  if (typeof raw !== 'string' || raw.length === 0) {
    return null;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
};
