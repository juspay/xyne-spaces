/**
 * Naming and key resolution for debug artifacts.
 *
 * Every "debug files not found" bug this codebase has had came from the same
 * root cause: three different places each GUESSED the storeKey a run had been
 * written under (`routes/debug.ts`, `webhook-commands/debug.ts`, and the GCS
 * archive path), and each guessed a slightly different set of shapes. Branch
 * keys, Digital-Twin per-user keys and userId-prefixed keys each broke a
 * different guesser.
 *
 * The fix has two halves, and both live here:
 *
 * 1. `candidateStoreKeys` — ONE list of shapes, used by every caller.
 * 2. The GCS run index — at run start we write a marker whose NAME contains the
 *    actual storeKey. Discovery then stops being a guess: list the markers for
 *    a conversation and you have the exact keys, including shapes nobody
 *    enumerated.
 *
 * Guessing remains as a fallback for runs written before the index existed.
 */

/** Mirrors `safeUserKeySegment` in xyne-claw-shared/tools/sandbox/tools.ts. */
function safeUserKeySegment(userId: string): string {
  const cleaned = userId.replace(/[^A-Za-z0-9]/g, "");
  return cleaned.length <= 40 ? cleaned : cleaned.slice(0, 40);
}

/** Filesystem/GCS-safe token: the charset `isSafeId` already enforces. */
export function safeRunToken(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "-");
}

/**
 * Session-dir names that are NOT sessions — the eviction/restore machinery
 * parks temporary copies alongside real ones. Matching these produced traces
 * attributed to the wrong run, or a 404 when the real dir sorted after them.
 */
const TEMP_DIR_MARKERS = [".stale-", ".restore-", ".pvc-", ".tmp-"];

export function isTempSessionDirName(name: string): boolean {
  return TEMP_DIR_MARKERS.some((m) => name.includes(m));
}

/**
 * Every storeKey shape a conversation can legitimately have been written under.
 *
 * Ordered most-specific first so a caller that stops at the first hit gets the
 * narrowest match. Callers should still try them all — a conversation can have
 * runs under several shapes when an agent slug changed mid-thread.
 */
export function candidateStoreKeys(
  convId: string,
  agentSlug?: string,
  userId?: string,
): string[] {
  const keys: string[] = [];
  const push = (k: string | undefined): void => {
    if (k && !keys.includes(k)) keys.push(k);
  };

  const slug = agentSlug?.trim();
  const uid = userId?.trim();

  if (slug) {
    // Digital-Twin per-user fold: `<convId>-<safeUserId>_<slug>`.
    if (uid) push(`${convId}-${safeUserKeySegment(uid)}_${slug}`);
    // Standard shared-thread key.
    push(`${convId}_${slug}`);
    // Agent-chat threads prefix the owner's userId.
    if (uid) push(`${uid}_${convId}_${slug}`);
  }
  // Bare conversation id (no agent slug in play).
  push(convId);
  if (uid) push(`${uid}_${convId}`);
  return keys;
}

/**
 * Does an on-disk session dir belong to `convId`?
 *
 * Deliberately stricter than a bare `startsWith(convId)`: the remainder after
 * the conversation id must look like a key segment, otherwise `conv-123` also
 * matches `conv-1234`, and one conversation's drawer shows another's runs.
 */
export function sessionDirMatchesConversation(dirName: string, convId: string): boolean {
  if (isTempSessionDirName(dirName)) return false;
  if (dirName === convId) return true;
  if (dirName.startsWith(`${convId}_`)) return true;
  // Digital-Twin fold `<convId>-<safeUserId>_<slug>`: the hyphenated remainder
  // must be an alphanumeric user segment followed by `_<slug>`.
  if (dirName.startsWith(`${convId}-`)) {
    return /^[A-Za-z0-9]{1,40}_[A-Za-z0-9_-]+$/.test(dirName.slice(convId.length + 1));
  }
  // userId-prefixed agent-chat threads: `<userId>_<convId>_<slug>`.
  if (dirName.includes(`_${convId}_`)) return true;
  if (dirName.endsWith(`_${convId}`)) return true;
  return false;
}

// ── Run identity ────────────────────────────────────────────────────────────

/** `<startedAtMs>-<safeSessionId>` — also the run directory name. */
export function runIdFor(startedAtMs: number, sessionId: string | undefined): string {
  return `${startedAtMs}-${safeRunToken(sessionId ?? "local")}`;
}

/**
 * Legacy v1 artifact name. Preserved EXACTLY — `routes/debug.ts`, the webhook
 * `/debug` command, the claw-auth proxy and the loop-watchdog tests all parse
 * this pattern.
 */
export function runFileNameFor(runId: string): string {
  return `debug-run-${runId}.json`;
}

const RUN_FILE_RE = /^debug-run-(\d{13,})-([A-Za-z0-9_-]+)\.json$/;

export function parseRunFileName(
  fileName: string,
): { runId: string; startedAtMs: number; sessionToken: string } | null {
  const m = RUN_FILE_RE.exec(fileName);
  if (!m) return null;
  const startedAtMs = Number(m[1]);
  if (!Number.isFinite(startedAtMs)) return null;
  return { runId: `${m[1]}-${m[2]}`, startedAtMs, sessionToken: m[2] as string };
}

/**
 * Start-of-run placeholder object.
 *
 * Deliberately NOT `runFileNameFor(runId)`: a header-only stub written to the
 * final snapshot's name would survive a failed finish-time upload and shadow
 * the complete trace forever. This name is only ever consulted when no richer
 * copy of the run exists anywhere.
 */
export function startingRunObjectName(runId: string): string {
  return `debug-run-${runId}.starting.json`;
}

export function isStartingRunObjectName(name: string): boolean {
  const base = name.slice(name.lastIndexOf("/") + 1);
  return base.startsWith("debug-run-") && base.endsWith(".starting.json");
}

/** Packed v2 run (gzipped ndjson of header + events + blobs). */
export function packedRunObjectName(runId: string): string {
  return `v2/${runId}.ndjson.gz`;
}

export function parsePackedRunObjectName(name: string): { runId: string } | null {
  const base = name.slice(name.lastIndexOf("/") + 1);
  if (!base.endsWith(".ndjson.gz")) return null;
  const runId = base.slice(0, -".ndjson.gz".length);
  return runId ? { runId } : null;
}

// ── GCS discovery index ─────────────────────────────────────────────────────

export const DEBUG_INDEX_PREFIX = "_index";

/**
 * Discovery marker: `_index/<convId>/<runId>~<storeKey>.json`.
 *
 * `~` is the separator because `isSafeId`'s charset (`[A-Za-z0-9_-]`) excludes
 * it, so neither a runId nor a storeKey can contain one — the split is
 * unambiguous no matter what a caller passes.
 */
export function indexObjectName(convId: string, runId: string, storeKey: string): string {
  return `${DEBUG_INDEX_PREFIX}/${convId}/${runId}~${storeKey}.json`;
}

export function indexPrefixFor(convId: string): string {
  return `${DEBUG_INDEX_PREFIX}/${convId}/`;
}

export function parseIndexObjectName(
  name: string,
): { convId: string; runId: string; storeKey: string; startedAtMs: number } | null {
  const parts = name.split("/");
  if (parts.length < 3) return null;
  const idx = parts.indexOf(DEBUG_INDEX_PREFIX);
  if (idx < 0 || parts.length < idx + 3) return null;
  const convId = parts[idx + 1];
  const leaf = parts[idx + 2];
  if (!convId || !leaf || !leaf.endsWith(".json")) return null;
  const body = leaf.slice(0, -".json".length);
  const sep = body.indexOf("~");
  if (sep <= 0) return null;
  const runId = body.slice(0, sep);
  const storeKey = body.slice(sep + 1);
  if (!runId || !storeKey) return null;
  const dash = runId.indexOf("-");
  const startedAtMs = dash > 0 ? Number(runId.slice(0, dash)) : Number.NaN;
  return {
    convId,
    runId,
    storeKey,
    startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : 0,
  };
}

/** Sort newest-first by the epoch embedded in the runId, never by string. */
export function compareRunIdsNewestFirst(a: string, b: string): number {
  const at = Number(a.slice(0, a.indexOf("-")));
  const bt = Number(b.slice(0, b.indexOf("-")));
  const av = Number.isFinite(at) ? at : 0;
  const bv = Number.isFinite(bt) ? bt : 0;
  if (av !== bv) return bv - av;
  return a < b ? 1 : a > b ? -1 : 0;
}
