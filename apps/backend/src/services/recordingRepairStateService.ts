import { randomUUID } from 'crypto';
import type { RecordingRepairReason, RecordingRepairStatus } from '@xyne/shared';
import { createRedisClient } from '@/services/redisFactory';
import {
  recordingRepairRedisKeys as keys,
  encodePendingMember,
  decodePendingMember,
  RECORDING_REPAIR_LEASE_SECONDS,
  RECORDING_REPAIR_TERMINAL_RETENTION_SECONDS,
} from '@/utils/recordingRepairRedisKeys';

// Redis-only control plane for offline-recorder transcript repairs. There is NO
// Postgres backstop: the user's local recording.webm is the durability guarantee.
// Flush-protection is structural — non-terminal captures (FINALIZED / PROCESSING /
// FAILED-retryable) carry NO TTL; only terminal captures (FAILED-non-retryable, or
// MERGED once artifacts are refreshed) get a retention TTL. Operators must run
// Redis with an eviction policy that does not drop non-volatile keys.
//
// Single-node Redis is assumed (same instance Bull uses); Lua scripts build capture
// keys from set members, which is not Redis-Cluster safe.

export type { RecordingRepairReason, RecordingRepairStatus };

export interface RecordingRepairOutage {
  startedAt: number;
  endedAt: number;
  reasons: RecordingRepairReason[];
}

export interface RecordingRepairCaptureState {
  status: RecordingRepairStatus;
  /** GCS path of the uploaded chunk_manifest.json (the repair source of truth). */
  manifestPath: string | null;
  /** SHA-256 of the manifest content; also the finalize idempotency key. */
  manifestHash: string | null;
  finalizedAt: number;
  processingError: string | null;
  mergedAt: number | null;
  retryable: boolean;
  leaseId: string | null;
  leaseExpiresAt: number | null;
  artifactsRefreshed: boolean;
}

const LEASE_MS = RECORDING_REPAIR_LEASE_SECONDS * 1000;

// --- Lua scripts (atomic on single-node Redis) ---

// Idempotent finalize: create FINALIZED state and index it, or return the existing
// hash untouched. Returns HGETALL of the capture either way.
const FINALIZE = `
local exists = redis.call('HEXISTS', KEYS[1], 'status')
if exists == 1 then
  return redis.call('HGETALL', KEYS[1])
end
redis.call('HSET', KEYS[1],
  'status', 'FINALIZED',
  'manifestPath', ARGV[2],
  'manifestHash', ARGV[3],
  'finalizedAt', ARGV[1],
  'processingError', '',
  'mergedAt', '',
  'retryable', '1',
  'leaseId', '',
  'leaseExpiresAt', '0',
  'artifactsRefreshed', '0')
redis.call('ZADD', KEYS[2], ARGV[1], ARGV[4])
redis.call('SADD', KEYS[3], ARGV[5])
redis.call('SADD', KEYS[4], ARGV[5])
return redis.call('HGETALL', KEYS[1])
`;

// Fenced claim → PROCESSING with a fresh lease. Claimable when FINALIZED, or
// FAILED-retryable, or PROCESSING with an expired lease. Returns HGETALL or nil.
const CLAIM = `
local status = redis.call('HGET', KEYS[1], 'status')
if not status then return nil end
local retryable = redis.call('HGET', KEYS[1], 'retryable')
local leaseExp = tonumber(redis.call('HGET', KEYS[1], 'leaseExpiresAt') or '0')
local now = tonumber(ARGV[3])
local claimable = false
if status == 'FINALIZED' then claimable = true
elseif status == 'FAILED' and retryable == '1' then claimable = true
elseif status == 'PROCESSING' and leaseExp < now then claimable = true end
if not claimable then return nil end
redis.call('HSET', KEYS[1],
  'status', 'PROCESSING',
  'processingError', '',
  'leaseId', ARGV[1],
  'leaseExpiresAt', tostring(now + tonumber(ARGV[2])))
return redis.call('HGETALL', KEYS[1])
`;

const HEARTBEAT = `
local status = redis.call('HGET', KEYS[1], 'status')
local lid = redis.call('HGET', KEYS[1], 'leaseId')
local exp = tonumber(redis.call('HGET', KEYS[1], 'leaseExpiresAt') or '0')
local now = tonumber(ARGV[3])
if status == 'PROCESSING' and lid == ARGV[1] and exp > now then
  redis.call('HSET', KEYS[1], 'leaseExpiresAt', tostring(now + tonumber(ARGV[2])))
  return 1
end
return 0
`;

const ASSERT_LEASE = `
local status = redis.call('HGET', KEYS[1], 'status')
local lid = redis.call('HGET', KEYS[1], 'leaseId')
local exp = tonumber(redis.call('HGET', KEYS[1], 'leaseExpiresAt') or '0')
if status == 'PROCESSING' and lid == ARGV[1] and exp > tonumber(ARGV[2]) then return 1 end
return 0
`;

// Fenced merge commit: only the lease holder may transition PROCESSING → MERGED.
const MARK_MERGED = `
local status = redis.call('HGET', KEYS[1], 'status')
local lid = redis.call('HGET', KEYS[1], 'leaseId')
if status == 'PROCESSING' and lid == ARGV[1] then
  redis.call('HSET', KEYS[1],
    'status', 'MERGED', 'processingError', '', 'mergedAt', ARGV[2],
    'leaseId', '', 'leaseExpiresAt', '0')
  redis.call('ZREM', KEYS[2], ARGV[3])
  redis.call('SREM', KEYS[3], ARGV[4])
  redis.call('SADD', KEYS[4], ARGV[5])
  return 1
end
return 0
`;

// Fenced failure commit. Non-retryable failures are terminal: de-index and TTL.
const MARK_FAILED = `
local status = redis.call('HGET', KEYS[1], 'status')
local lid = redis.call('HGET', KEYS[1], 'leaseId')
if not (status == 'PROCESSING' and lid == ARGV[1]) then return 0 end
redis.call('HSET', KEYS[1],
  'status', 'FAILED', 'processingError', ARGV[2], 'retryable', ARGV[3],
  'leaseId', '', 'leaseExpiresAt', '0')
if ARGV[3] == '0' then
  redis.call('ZREM', KEYS[2], ARGV[4])
  redis.call('SREM', KEYS[3], ARGV[5])
  redis.call('EXPIRE', KEYS[1], ARGV[6])
end
return 1
`;

// Mark every MERGED capture of a call as artifacts-refreshed (terminal → TTL) and
// clear the call from the needs-artifacts index.
const MARK_ARTIFACTS_REFRESHED = `
local members = redis.call('SMEMBERS', KEYS[1])
for i = 1, #members do
  local capKey = ARGV[3] .. members[i]
  if redis.call('HGET', capKey, 'status') == 'MERGED' then
    redis.call('HSET', capKey, 'artifactsRefreshed', '1')
    redis.call('EXPIRE', capKey, ARGV[2])
  end
end
redis.call('SREM', KEYS[2], ARGV[1])
return 1
`;

function toHash(flat: unknown): Record<string, string> | null {
  if (!Array.isArray(flat) || flat.length === 0) return null;
  const hash: Record<string, string> = {};
  for (let i = 0; i + 1 < flat.length; i += 2) hash[String(flat[i])] = String(flat[i + 1]);
  return hash;
}

function stateFromHash(hash: Record<string, string> | null): RecordingRepairCaptureState | null {
  if (!hash || !hash.status) return null;
  return {
    status: hash.status as RecordingRepairStatus,
    manifestPath: hash.manifestPath || null,
    manifestHash: hash.manifestHash || null,
    finalizedAt: Number(hash.finalizedAt),
    processingError: hash.processingError || null,
    mergedAt: hash.mergedAt ? Number(hash.mergedAt) : null,
    retryable: hash.retryable === '1',
    leaseId: hash.leaseId || null,
    leaseExpiresAt: hash.leaseExpiresAt && hash.leaseExpiresAt !== '0' ? Number(hash.leaseExpiresAt) : null,
    artifactsRefreshed: hash.artifactsRefreshed === '1',
  };
}

class RecordingRepairStateService {
  private readonly redis = createRedisClient('recording-repair');

  async get(callId: string, captureId: string): Promise<RecordingRepairCaptureState | null> {
    const hash = toHash(await this.redis.hgetall(keys.capture(callId, captureId)));
    return stateFromHash(hash);
  }

  async finalize(
    callId: string,
    captureId: string,
    manifestPath: string,
    manifestHash: string
  ): Promise<RecordingRepairCaptureState> {
    const now = Date.now();
    const result = await this.redis.eval(
      FINALIZE,
      4,
      keys.capture(callId, captureId),
      keys.pending,
      keys.callUnmerged(callId),
      keys.callCaptures(callId),
      String(now),
      manifestPath,
      manifestHash,
      encodePendingMember(callId, captureId),
      captureId
    );
    const state = stateFromHash(toHash(result));
    if (!state) throw new Error('Recording repair capture id belongs to another recording');
    return state;
  }

  async claim(callId: string, captureId: string): Promise<RecordingRepairCaptureState | null> {
    const result = await this.redis.eval(
      CLAIM,
      1,
      keys.capture(callId, captureId),
      randomUUID(),
      String(LEASE_MS),
      String(Date.now())
    );
    return stateFromHash(toHash(result));
  }

  async heartbeat(callId: string, captureId: string, leaseId: string): Promise<boolean> {
    const result = await this.redis.eval(
      HEARTBEAT,
      1,
      keys.capture(callId, captureId),
      leaseId,
      String(LEASE_MS),
      String(Date.now())
    );
    return result === 1;
  }

  async assertLease(callId: string, captureId: string, leaseId: string): Promise<void> {
    const result = await this.redis.eval(
      ASSERT_LEASE,
      1,
      keys.capture(callId, captureId),
      leaseId,
      String(Date.now())
    );
    if (result !== 1) throw new Error('Recording repair lease was lost');
  }

  async markMerged(callId: string, captureId: string, leaseId: string): Promise<void> {
    const result = await this.redis.eval(
      MARK_MERGED,
      4,
      keys.capture(callId, captureId),
      keys.pending,
      keys.callUnmerged(callId),
      keys.needsArtifacts,
      leaseId,
      String(Date.now()),
      encodePendingMember(callId, captureId),
      captureId,
      callId
    );
    if (result !== 1) throw new Error('Recording repair lease was lost before merge commit');
  }

  async markFailed(
    callId: string,
    captureId: string,
    error: string,
    leaseId: string,
    retryable = true
  ): Promise<void> {
    const result = await this.redis.eval(
      MARK_FAILED,
      3,
      keys.capture(callId, captureId),
      keys.pending,
      keys.callUnmerged(callId),
      leaseId,
      error.slice(0, 1000),
      retryable ? '1' : '0',
      encodePendingMember(callId, captureId),
      captureId,
      String(RECORDING_REPAIR_TERMINAL_RETENTION_SECONDS)
    );
    if (result !== 1) throw new Error('Recording repair lease was lost before failure commit');
  }

  async findPending(): Promise<Array<{ callId: string; captureId: string }>> {
    const members = await this.redis.zrange(keys.pending, 0, 999);
    return members
      .map((member) => decodePendingMember(member))
      .filter((item): item is { callId: string; captureId: string } => item !== null);
  }

  async hasUnmergedForCall(callId: string): Promise<boolean> {
    return (await this.redis.scard(keys.callUnmerged(callId))) > 0;
  }

  async findCallsNeedingArtifactRefresh(): Promise<string[]> {
    const callIds = await this.redis.smembers(keys.needsArtifacts);
    const ready = await Promise.all(
      callIds.map(async (callId) => ((await this.redis.scard(keys.callUnmerged(callId))) === 0 ? callId : null))
    );
    return ready.filter((callId): callId is string => callId !== null).slice(0, 100);
  }

  async needsArtifactRefresh(callId: string): Promise<boolean> {
    if ((await this.redis.sismember(keys.needsArtifacts, callId)) !== 1) return false;
    return (await this.redis.scard(keys.callUnmerged(callId))) === 0;
  }

  async markArtifactsRefreshed(callId: string): Promise<void> {
    await this.redis.eval(
      MARK_ARTIFACTS_REFRESHED,
      2,
      keys.callCaptures(callId),
      keys.needsArtifacts,
      callId,
      String(RECORDING_REPAIR_TERMINAL_RETENTION_SECONDS),
      `rr:cap:${callId}:`
    );
  }

  async listDeletableCaptureIdsForCall(callId: string): Promise<string[]> {
    const captureIds = await this.redis.smembers(keys.callCaptures(callId));
    const deletable = await Promise.all(
      captureIds.map(async (captureId) => {
        const state = await this.get(callId, captureId);
        if (!state) return null;
        const done =
          (state.status === 'MERGED' && state.artifactsRefreshed) ||
          (state.status === 'FAILED' && !state.retryable);
        return done ? captureId : null;
      })
    );
    return deletable.filter((captureId): captureId is string => captureId !== null);
  }

  /**
   * Terminal captures self-expire via TTL, so purge only GCs `rr:pending`
   * tombstones (members whose capture hash has already expired) to keep the
   * claimable index bounded.
   */
  async purgeCompleted(): Promise<number> {
    const members = await this.redis.zrange(keys.pending, 0, 999);
    let removed = 0;
    for (const member of members) {
      const item = decodePendingMember(member);
      if (!item) {
        await this.redis.zrem(keys.pending, member);
        removed += 1;
        continue;
      }
      if ((await this.redis.exists(keys.capture(item.callId, item.captureId))) === 0) {
        await this.redis.zrem(keys.pending, member);
        removed += 1;
      }
    }
    return removed;
  }

  async markLiveTranscriptFinalized(callId: string): Promise<void> {
    await this.redis.set(keys.callLiveFinalized(callId), '1');
  }

  async isLiveTranscriptFinalized(callId: string): Promise<boolean> {
    return (await this.redis.exists(keys.callLiveFinalized(callId))) === 1;
  }
}

export const recordingRepairStateService = new RecordingRepairStateService();
