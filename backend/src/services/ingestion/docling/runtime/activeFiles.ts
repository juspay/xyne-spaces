/**
 * Redis slot: caps the number of files that have entered the OCR pipeline
 * simultaneously (across the splitter → writer path). A file acquires a slot
 * on first submit and releases it on completion or failure.
 *
 * Ported from xyne-search (node-redis sendCommand → ioredis eval).
 */
import { redisService } from '@/services/redisService'
import { config } from '@/config/env'
import { logger } from '@/utils/logger'

const ACTIVE_FILES_KEY = 'docling:async:active-files'
const ACTIVE_FILE_META_PREFIX = 'docling:async:active-file'
const MIN_ACTIVE_FILE_LEASE_TTL_MS = 60 * 60 * 1000

const ACQUIRE_SCRIPT = `
local active_key = KEYS[1]
local meta_key = KEYS[2]
local now_ms = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local expires_at_ms = tonumber(ARGV[3])
local lease_ttl_ms = tonumber(ARGV[4])
local file_id = ARGV[5]
redis.call("ZREMRANGEBYSCORE", active_key, "-inf", now_ms)
if redis.call("ZSCORE", active_key, file_id) then
  redis.call("ZADD", active_key, expires_at_ms, file_id)
  redis.call("PEXPIRE", meta_key, lease_ttl_ms)
  return 2
end
if redis.call("ZCARD", active_key) >= capacity then
  return 0
end
redis.call("ZADD", active_key, expires_at_ms, file_id)
redis.call("HSET", meta_key, "fileId", file_id, "fileName", ARGV[6], "acquiredAt", ARGV[7], "expiresAt", ARGV[3])
redis.call("PEXPIRE", meta_key, lease_ttl_ms)
return 1
`

const RELEASE_SCRIPT = `
local removed = redis.call("ZREM", KEYS[1], ARGV[1])
redis.call("DEL", KEYS[2])
return removed
`

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const activeFileMetaKey = (fileId: string) => `${ACTIVE_FILE_META_PREFIX}:${fileId}`
const getClient = () => redisService.getClient()

const activeFileLeaseTtlMs = () =>
  Math.max(config.doclingScheduler.submitPermitLeaseTtlMs, MIN_ACTIVE_FILE_LEASE_TTL_MS)

const tryAcquireActiveFile = async (input: { fileId: string; fileName?: string | null }): Promise<number> => {
  const limit = config.doclingScheduler.activeOcrFiles
  if (limit <= 0) return 1
  const now = Date.now()
  const leaseTtlMs = activeFileLeaseTtlMs()
  const result = await getClient().eval(
    ACQUIRE_SCRIPT, 2,
    ACTIVE_FILES_KEY, activeFileMetaKey(input.fileId),
    String(now), String(limit), String(now + leaseTtlMs), String(leaseTtlMs),
    input.fileId, input.fileName || input.fileId, new Date(now).toISOString(),
  )
  return Number(result)
}

export const acquireDoclingActiveFile = async (input: { fileId: string; fileName?: string | null }): Promise<void> => {
  const limit = config.doclingScheduler.activeOcrFiles
  if (limit <= 0) return
  const waitStartedAt = Date.now()
  while (true) {
    const acquired = await tryAcquireActiveFile(input)
    if (acquired > 0) {
      logger.info('[DOCLING] Acquired active-file slot', {
        fileId: input.fileId, limit, reused: acquired === 2, waitMs: Date.now() - waitStartedAt,
      })
      return
    }
    logger.warn('[DOCLING] Waiting for active-file slot', {
      fileId: input.fileId, limit, waitedMs: Date.now() - waitStartedAt,
    })
    await sleep(config.doclingScheduler.pollMs)
  }
}

export const releaseDoclingActiveFile = async (fileId?: string | null): Promise<void> => {
  const limit = config.doclingScheduler.activeOcrFiles
  if (!fileId || limit <= 0) return
  const result = await getClient().eval(
    RELEASE_SCRIPT, 2,
    ACTIVE_FILES_KEY, activeFileMetaKey(fileId),
    fileId,
  )
  if (Number(result) > 0) {
    logger.info('[DOCLING] Released active-file slot', { fileId })
  }
}
