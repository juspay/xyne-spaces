/**
 * Redis key schema for the offline-first recorder's repair control plane.
 *
 * This is the ONLY durable store for repair control state — there is no Postgres
 * backstop. The user's local `recording.webm` is the durability guarantee; if
 * Redis is lost, the transcript-repair job is forfeit but the audio survives.
 *
 * Flush-protection rule (load-bearing): keys for captures that are still
 * FINALIZED / PROCESSING (or FAILED-retryable) MUST NOT carry an eviction-eligible
 * TTL. Only terminal captures (MERGED+artifactsRefreshed, FAILED+!retryable) get a
 * retention TTL. See RECORDING_REPAIR_TERMINAL_RETENTION_SECONDS.
 *
 * Single-node Redis is assumed (same instance Bull uses via getRedisConfig()); keys
 * are not hash-tagged for cluster co-location.
 */

const NS = 'rr';

export const recordingRepairRedisKeys = {
  /** HASH: full capture state (status, lease, outagesHash, manifestPath/Hash, flags). */
  capture: (callId: string, captureId: string): string =>
    `${NS}:cap:${callId}:${captureId}`,

  /**
   * ZSET (member = `${callId}:${captureId}`, score = finalizedAt) of every capture
   * that is neither MERGED nor FAILED-non-retryable — i.e. still worth working on.
   * Replaces the Postgres `findPending` scan.
   */
  pending: `${NS}:pending`,

  /** SET of ALL captureIds ever finalized for a call (enumeration index; trimmed only on purge). */
  callCaptures: (callId: string): string => `${NS}:call:${callId}:captures`,

  /**
   * SET of captureIds for a call that are not yet MERGED and not FAILED-non-retryable
   * (i.e. could still merge). Empty ⇒ safe to (re)generate the call's artifacts.
   * Replaces the Postgres `hasUnmergedForCall` query.
   */
  callUnmerged: (callId: string): string => `${NS}:call:${callId}:unmerged`,

  /** Global SET of callIds that have a MERGED capture whose artifacts still need regenerating. */
  needsArtifacts: `${NS}:needsArtifacts`,

  /** STRING flag "1": the live transcript for this call has been finalized (repair may start). */
  callLiveFinalized: (callId: string): string => `${NS}:call:${callId}:live`,
} as const;

/** Encode a `rr:pending` ZSET member. */
export function encodePendingMember(callId: string, captureId: string): string {
  return `${callId}:${captureId}`;
}

/** Decode a `rr:pending` ZSET member. Returns null if malformed. */
export function decodePendingMember(member: string): { callId: string; captureId: string } | null {
  const idx = member.indexOf(':');
  if (idx <= 0 || idx >= member.length - 1) return null;
  return { callId: member.slice(0, idx), captureId: member.slice(idx + 1) };
}

/** Lease duration for a claimed repair (renewed by the worker heartbeat). */
export const RECORDING_REPAIR_LEASE_SECONDS = 120;

/** Retention for terminal captures before purge. */
export const RECORDING_REPAIR_TERMINAL_RETENTION_SECONDS = 30 * 24 * 60 * 60;
