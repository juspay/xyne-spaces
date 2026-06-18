/**
 * Lua-semaphore permits for the OCR scheduler.
 * Two variants:
 *   - tryAcquireDoclingSchedulerPermit  (count-based, for vespa-write)
 *   - tryAcquireDoclingSchedulerWeightedPermit  (page-budget, for ocr-submit)
 *
 * Ported from doclingScheduler/redis.ts (ioredis).
 */
import { randomUUID } from 'node:crypto'
import { redisService } from '@/services/redisService'

const PERMIT_PREFIX = 'docling:scheduler:permit'

const ACQUIRE_SCRIPT = `
local active_key = KEYS[1]
local meta_key = KEYS[2]
local now_ms = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local expires_at_ms = tonumber(ARGV[3])
local ttl_ms = tonumber(ARGV[4])
local permit_id = ARGV[5]
redis.call("ZREMRANGEBYSCORE", active_key, "-inf", now_ms)
if redis.call("ZCARD", active_key) >= capacity then
  return 0
end
redis.call("ZADD", active_key, expires_at_ms, permit_id)
redis.call("HSET", meta_key, "permitId", permit_id, "kind", ARGV[6], "owner", ARGV[7], "createdAt", ARGV[8], "expiresAt", ARGV[3], "metadata", ARGV[9])
redis.call("PEXPIRE", meta_key, ttl_ms)
return 1
`

const ACQUIRE_WEIGHTED_SCRIPT = `
local active_key = KEYS[1]
local meta_key = KEYS[2]
local now_ms = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local expires_at_ms = tonumber(ARGV[3])
local ttl_ms = tonumber(ARGV[4])
local permit_id = ARGV[5]
local weight = tonumber(ARGV[6])
local allow_oversize = ARGV[7] == "1"
redis.call("ZREMRANGEBYSCORE", active_key, "-inf", now_ms)
local current_weight = 0
local members = redis.call("ZRANGE", active_key, 0, -1, "WITHSCORES")
for i = 2, #members, 2 do
  local meta = redis.call("HGET", "docling:scheduler:permit:weight:" .. members[i-1], "weight")
  if meta then
    current_weight = current_weight + tonumber(meta)
  else
    current_weight = current_weight + 1
  end
end
if current_weight + weight > capacity then
  if not (allow_oversize and current_weight == 0) then
    return 0
  end
end
redis.call("ZADD", active_key, expires_at_ms, permit_id)
redis.call("HSET", meta_key, "permitId", permit_id, "kind", ARGV[8], "owner", ARGV[9], "weight", weight, "createdAt", ARGV[10], "expiresAt", ARGV[3], "metadata", ARGV[11])
redis.call("PEXPIRE", meta_key, ttl_ms)
return 1
`

const RELEASE_SCRIPT = `
local removed = redis.call("ZREM", KEYS[1], ARGV[1])
redis.call("DEL", KEYS[2])
return removed
`

export type DoclingSchedulerPermit = { kind: string; permitId: string }

const activeKey = (kind: string) => `${PERMIT_PREFIX}:${kind}:active`
const metaKey = (kind: string, permitId: string) => `${PERMIT_PREFIX}:${kind}:${permitId}`
const getClient = () => redisService.getClient()

export const tryAcquireDoclingSchedulerPermit = async (input: {
  kind: string
  capacity: number
  ttlMs: number
  owner: string
  metadata?: Record<string, unknown>
}): Promise<DoclingSchedulerPermit | null> => {
  if (input.capacity <= 0) {
    return { kind: input.kind, permitId: `disabled:${input.kind}:${randomUUID()}` }
  }
  const now = Date.now()
  const permitId = randomUUID()
  const acquired = await getClient().eval(
    ACQUIRE_SCRIPT, 2,
    activeKey(input.kind), metaKey(input.kind, permitId),
    String(now), String(input.capacity),
    String(now + input.ttlMs), String(input.ttlMs),
    permitId, input.kind, input.owner,
    new Date(now).toISOString(), JSON.stringify(input.metadata || {}),
  )
  return Number(acquired) > 0 ? { kind: input.kind, permitId } : null
}

export const tryAcquireDoclingSchedulerWeightedPermit = async (input: {
  kind: string
  permitId: string
  capacity: number
  weight: number
  ttlMs: number
  owner: string
  allowOversizeWhenEmpty?: boolean
  metadata?: Record<string, unknown>
}): Promise<DoclingSchedulerPermit | null> => {
  if (input.capacity <= 0) {
    return { kind: input.kind, permitId: `disabled:${input.kind}:${input.permitId}` }
  }
  const now = Date.now()
  const acquired = await getClient().eval(
    ACQUIRE_WEIGHTED_SCRIPT, 2,
    activeKey(input.kind), metaKey(input.kind, input.permitId),
    String(now), String(input.capacity),
    String(now + input.ttlMs), String(input.ttlMs),
    input.permitId, String(input.weight),
    input.allowOversizeWhenEmpty ? '1' : '0',
    input.kind, input.owner,
    new Date(now).toISOString(), JSON.stringify(input.metadata || {}),
  )
  return Number(acquired) > 0 ? { kind: input.kind, permitId: input.permitId } : null
}

export const releaseDoclingSchedulerPermit = async (
  permit: { kind: string; permitId?: string | null },
): Promise<void> => {
  if (!permit.permitId || permit.permitId.startsWith('disabled:')) return
  await getClient().eval(
    RELEASE_SCRIPT, 2,
    activeKey(permit.kind), metaKey(permit.kind, permit.permitId),
    permit.permitId,
  )
}

export const releaseDoclingOcrSubmitPermit = async (
  permit: DoclingSchedulerPermit | { permitId?: string | null },
): Promise<void> => {
  if (!permit.permitId || permit.permitId.startsWith('disabled:')) return
  await Promise.all([
    releaseDoclingSchedulerPermit({ kind: 'ocr-submit', permitId: permit.permitId }),
    releaseDoclingSchedulerPermit({ kind: 'ocr-submit-pages', permitId: permit.permitId }),
  ])
}

export const listActiveDoclingSchedulerPermitIds = async (kind: string, limit = 200): Promise<string[]> => {
  const now = Date.now()
  const client = getClient()
  await client.zremrangebyscore(activeKey(kind), '-inf', String(now))
  return client.zrange(activeKey(kind), 0, limit - 1)
}
