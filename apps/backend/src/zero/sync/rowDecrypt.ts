/**
 * Emit-time decryption of at-rest encrypted fields for the sync fan-out.
 *
 * At-rest ciphertext (`ENC:…`, org-keyed by the encryption service) is preserved
 * EVERYWHERE server-side at rest — the zero-cache replica delivers it and the Redis
 * snap/stream store it verbatim. Rows are decrypted only at the emit boundary, in RAM,
 * en route to a client socket (TLS carries the plaintext, exactly like every REST
 * response). Content-driven: only string values carrying the `ENC:` prefix in
 * `encryptedFieldsConfig` fields are touched, so plaintext deployments never pay the
 * provider hop — and never even load the provider (its import is lazy, which keeps the
 * env-free sync unit tests import-safe).
 *
 * Failure semantics (the ingest-atomicity C2 rule applied to emits): decryption trouble
 * — provider error, timeout, response-shape mismatch — never blocks or drops a frame.
 * Affected values ship AS CIPHERTEXT with a loud log: visible, non-corrupting, and
 * self-healing on the row's next write or the client's next snapshot.
 *
 * The cipher→plain cache is content-addressed (a ciphertext string maps to exactly one
 * plaintext — the envelope embeds key id + IV), so it is safe to share across
 * instances, snapshots, resumes and dispatches; provider QPS scales with DISTINCT new
 * ciphertexts (≈ the write rate on encrypted tables), not with deliveries.
 */
import { encryptedFieldsConfig } from '@xyne/shared';
import { syncMetrics } from './metrics';

/** Lazy logger: `@/utils/logger` pulls config/env at load, which env-free unit tests must not. */
function logDecryptFailure(fields: Record<string, unknown>): void {
  void import('@/utils/logger')
    .then(({ logger }) => logger.error('sync_emit_decrypt_failed', fields))
    .catch(() => {
      // eslint-disable-next-line no-console
      console.error('sync_emit_decrypt_failed', fields);
    });
}

type Row = Record<string, unknown>;

/** The shape every emit path shares (CompactedRow and StreamDiff upserts both satisfy it). */
export interface EmitRow {
  tableName: string;
  row: Row;
}

export interface DecryptDeps {
  decryptBatch: (values: string[]) => Promise<string[]>;
  /** Per-chunk ceiling; a slow encryption service must not wedge the serialized dispatch queue. */
  timeoutMs?: number;
  /** Conservative until the provider's real batch limit is confirmed. */
  chunkSize?: number;
}

const ENC_PREFIX = 'ENC:';
const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_CHUNK = 100;
const CACHE_MAX = 5_000;

/** cipher → plain, LRU via Map insertion order (get re-inserts, put evicts the oldest). */
const cache = new Map<string, string>();
syncMetrics.gauge('sync_engine_decrypt_cache_entries', {}, () => cache.size);

function cacheGet(cipher: string): string | undefined {
  const hit = cache.get(cipher);
  if (hit !== undefined) {
    cache.delete(cipher);
    cache.set(cipher, hit);
  }
  return hit;
}

function cachePut(cipher: string, plain: string): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(cipher, plain);
}

/** Test seam: the cache is module-global state. */
export function clearDecryptCacheForTests(): void {
  cache.clear();
}

let lazyDeps: DecryptDeps | null = null;
async function defaultDeps(): Promise<DecryptDeps> {
  if (!lazyDeps) {
    // Lazy: the provider pulls config/env at module load, which env-free unit tests must not.
    const { getEncryptionProvider } = await import('@/services/encryption');
    const provider = getEncryptionProvider();
    lazyDeps = { decryptBatch: (values) => provider.decryptBatch(values) };
  }
  return lazyDeps;
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`decryptBatch timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Decrypt the configured encrypted fields of `items` for emission. Returns the SAME array
 * when nothing needs decrypting (the plaintext fast path); otherwise returns copies for
 * the affected items — the input rows are never mutated (they may be memoized ciphertext
 * state elsewhere).
 */
export async function decryptRowsForEmit<T extends EmitRow>(
  items: readonly T[],
  deps?: DecryptDeps,
): Promise<readonly T[]> {
  // Pass 1: find ENC-prefixed values in configured fields; collect cache misses.
  let any = false;
  const misses = new Set<string>();
  for (const item of items) {
    const cfg = encryptedFieldsConfig[item.tableName];
    if (!cfg) continue;
    for (const field of cfg.fields) {
      const v = item.row[field];
      if (typeof v === 'string' && v.startsWith(ENC_PREFIX)) {
        any = true;
        if (cacheGet(v) === undefined) misses.add(v);
        else syncMetrics.count('sync_engine_decrypt_values_total', { result: 'cache_hit' });
      }
    }
  }
  if (!any) return items;

  // Pass 2: decrypt misses — chunked, time-boxed, fail-soft per chunk.
  if (misses.size > 0) {
    const d = deps ?? (await defaultDeps());
    const chunkSize = d.chunkSize ?? DEFAULT_CHUNK;
    const timeoutMs = d.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const pending = [...misses];
    for (let i = 0; i < pending.length; i += chunkSize) {
      const slice = pending.slice(i, i + chunkSize);
      const batchStart = Date.now();
      try {
        const out = await withTimeout(d.decryptBatch([...slice]), timeoutMs);
        if (!Array.isArray(out) || out.length !== slice.length) {
          throw new Error(`decryptBatch returned ${Array.isArray(out) ? out.length : typeof out} results for ${slice.length} values`);
        }
        slice.forEach((cipher, j) => cachePut(cipher, out[j]));
        syncMetrics.observe('sync_engine_decrypt_batch_latency', Date.now() - batchStart);
        syncMetrics.count('sync_engine_decrypt_values_total', { result: 'decrypted' }, slice.length);
      } catch (e) {
        syncMetrics.observe('sync_engine_decrypt_batch_latency', Date.now() - batchStart);
        syncMetrics.count('sync_engine_decrypt_values_total', { result: 'failed' }, slice.length);
        logDecryptFailure({
          values: slice.length,
          error: e instanceof Error ? e.message : String(e),
        });
        // Affected values ship as ciphertext this frame; the next write/snapshot retries.
      }
    }
  }

  // Pass 3: substitute from the cache into copies.
  return items.map((item) => {
    const cfg = encryptedFieldsConfig[item.tableName];
    if (!cfg) return item;
    let row: Row | null = null;
    for (const field of cfg.fields) {
      const v = item.row[field];
      if (typeof v === 'string' && v.startsWith(ENC_PREFIX)) {
        const plain = cacheGet(v);
        if (plain !== undefined) {
          row ??= { ...item.row };
          row[field] = plain;
        }
      }
    }
    return row ? { ...item, row } : item;
  });
}
