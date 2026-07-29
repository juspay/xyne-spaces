/**
 * Redis results stream helpers — the wrapper publishes OCR completions to
 * `docling:results`; the result worker consumes them via a consumer group.
 *
 * Adapted from doclingScheduler/redis.ts (ioredis).
 */
import Redis, { type RedisOptions } from 'ioredis'
import { redisService } from '@/services/redisService'
import { config } from '@/config/env'

const sched = () => config.doclingScheduler
const getClient = () => redisService.getClient()

/** A dedicated connection for the blocking stream read (don't share it). */
export const createBlockingRedisConnection = (): Redis =>
  new Redis(redisService.getRedisConfig() as RedisOptions)

export interface DoclingResultEvent {
  id: string
  jobId: string
  fileId: string | null
  docId: string | null
  status: string
  resultKey: string | null
  error: string | null
}

const fieldsToObject = (fields: string[]): Record<string, string> => {
  const out: Record<string, string> = {}
  for (let i = 0; i + 1 < fields.length; i += 2) out[fields[i]] = fields[i + 1]
  return out
}

const toResultEvent = (id: string, fields: string[]): DoclingResultEvent => {
  const f = fieldsToObject(fields)
  return {
    id,
    jobId: f.job_id || '',
    fileId: f.file_id || null,
    docId: f.doc_id || null,
    status: f.status || '',
    resultKey: f.result_key || null,
    error: f.error || null,
  }
}

export const ensureResultConsumerGroup = async (): Promise<void> => {
  try {
    await getClient().xgroup('CREATE', sched().resultsStream, sched().resultGroup, '$', 'MKSTREAM')
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (!msg.includes('BUSYGROUP')) throw error
  }
}

export const readResultEvents = async (conn: Redis, consumerName: string): Promise<DoclingResultEvent[]> => {
  const res = (await conn.xreadgroup(
    'GROUP', sched().resultGroup, consumerName,
    'COUNT', sched().resultReadCount,
    'BLOCK', sched().resultBlockMs,
    'STREAMS', sched().resultsStream, '>',
  )) as [string, [string, string[]][]][] | null
  if (!res) return []
  const events: DoclingResultEvent[] = []
  for (const [, entries] of res) {
    for (const [id, fields] of entries) events.push(toResultEvent(id, fields))
  }
  return events
}

export const claimStaleResultEvents = async (consumerName: string): Promise<DoclingResultEvent[]> => {
  const res = (await getClient().xautoclaim(
    sched().resultsStream, sched().resultGroup, consumerName,
    sched().resultMinIdleMs, '0', 'COUNT', sched().resultReadCount,
  )) as [string, [string, string[]][], string[]?] | null
  if (!res) return []
  const entries = res[1] || []
  return entries.map(([id, fields]) => toResultEvent(id, fields))
}

export const ackResultEvent = async (id: string): Promise<void> => {
  await getClient().xack(sched().resultsStream, sched().resultGroup, id)
}

export const getResultPayload = async (resultKey: string): Promise<string | null> => {
  return getClient().get(resultKey)
}
