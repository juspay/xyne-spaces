import { getStorageAdapter } from '../machines/queryCacheMachine.js';

const SHADOW_PREFIX = 'warm_shadow:v1';
const MAX_AGE_MS = 30 * 60 * 1000;

export type ShadowEntry<T = unknown> = {
  data: [T, { type: 'complete' }];
  lastUpdatedAt?: number;
  savedAt?: number;
};

function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    const keys = Object.keys(value as object).sort();
    for (const k of keys) {
      const v = (value as Record<string, unknown>)[k];
      if (v === undefined) continue;
      out[k] = canonicalize(v);
    }
    return out;
  }
  return value;
}

export function canonicalArgsJson(args: unknown): string {
  return JSON.stringify(canonicalize(args ?? {}));
}

export function shadowKeyFor(userID: string, queryName: string, args: unknown): string {
  return `${SHADOW_PREFIX}:${userID}:${queryName}:${canonicalArgsJson(args)}`;
}

export async function readShadow<T = unknown>(
  userID: string,
  queryName: string,
  args: unknown,
): Promise<ShadowEntry<T> | null> {
  const adapter = getStorageAdapter();
  if (!adapter?.readShadowValue) return null;
  try {
    const key = shadowKeyFor(userID, queryName, args);
    const raw = await adapter.readShadowValue(key);
    if (!raw || typeof raw !== 'object') return null;
    const entry = raw as ShadowEntry<T>;
    if (entry.savedAt && Date.now() - entry.savedAt > MAX_AGE_MS) {
      void adapter.removeShadowValue?.(key);
      return null;
    }
    if (!entry.data || !Array.isArray(entry.data)) return null;
    return entry;
  } catch {
    return null;
  }
}

/**
 * Read a shadow entry and delete the shadow key. Intended for read-time promote:
 * the caller then writes the entry into the hash-based cache under the true hash,
 * so subsequent mounts hit that path directly.
 */
export async function consumeShadow<T = unknown>(
  userID: string,
  queryName: string,
  args: unknown,
): Promise<ShadowEntry<T> | null> {
  const adapter = getStorageAdapter();
  const entry = await readShadow<T>(userID, queryName, args);
  if (entry && adapter?.removeShadowValue) {
    void adapter.removeShadowValue(shadowKeyFor(userID, queryName, args));
  }
  return entry;
}

export async function writeShadow<T>(
  userID: string,
  queryName: string,
  args: unknown,
  entry: ShadowEntry<T>,
): Promise<void> {
  const adapter = getStorageAdapter();
  if (!adapter?.writeShadowValue) return;
  const key = shadowKeyFor(userID, queryName, args);
  await adapter.writeShadowValue(key, { ...entry, savedAt: Date.now() });
}

export async function removeShadow(
  userID: string,
  queryName: string,
  args: unknown,
): Promise<void> {
  const adapter = getStorageAdapter();
  if (!adapter?.removeShadowValue) return;
  await adapter.removeShadowValue(shadowKeyFor(userID, queryName, args));
}
