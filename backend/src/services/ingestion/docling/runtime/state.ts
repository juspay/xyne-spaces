/**
 * Redis hash state for the async OCR path that uses the Redis state model
 * (not the Postgres scheduler). Used by the legacy result worker.
 *
 * Ported from xyne-search (node-redis → ioredis).
 */
import { redisService } from '@/services/redisService'
import { config } from '@/config/env'

const FILE_PREFIX = 'docling:async:file'
const getClient = () => redisService.getClient()

export type DoclingAsyncFileState = {
  fileId: string
  vespaDocId: string
  runId: string
  splitFingerprint: string
  fileName: string
  collectionId: string
  collectionName: string
  parentId: string
  path: string
  storagePath: string
  mimeType: string
  baseMimeType: string
  fileSize: string
  originalName: string
  uploadedByEmail: string
  metadataJson: string
  pageTitle: string
  totalPages: string
  totalParts: string
  pageChunkSize: string
  stageDir: string
  partsDir: string
  nextPartToApply: string
  nextPartToSubmit: string
  textChunksCount: string
  imageChunksCount: string
  tocChunksCount: string
  status: 'submitting' | 'submitted' | 'applying' | 'completed' | 'failed'
  initialVespaInserted: 'true' | 'false'
  createdAt: string
  updatedAt: string
}

export type DoclingAsyncPartState = {
  fileId: string
  vespaDocId: string
  runId: string
  splitFingerprint: string
  jobId: string
  docId: string
  partIndex: string
  startPage: string
  endPage: string
  totalPages: string
  totalParts: string
  fileName: string
  partPath: string
  partSizeBytes: string
  status: 'queued' | 'pending' | 'submitted' | 'ready' | 'applying' | 'applied' | 'completed' | 'failed'
  resultKey: string
  eventId: string
  error: string
  submitCount: string
  createdAt: string
  updatedAt: string
  appliedAt: string
}

export const doclingAsyncFileKey = (fileId: string) => `${FILE_PREFIX}:${fileId}`
export const doclingAsyncPartKey = (fileId: string, partIndex: number) => `${doclingAsyncFileKey(fileId)}:part:${partIndex}`
export const doclingAsyncPartResultKey = (fileId: string, partIndex: number) => `${doclingAsyncPartKey(fileId, partIndex)}:result`
export const doclingAsyncApplyLockKey = (fileId: string) => `${doclingAsyncFileKey(fileId)}:apply-lock`

export const nullableFromRedis = (value?: string | null) => (value && value.length > 0 ? value : null)

export const numberFromRedis = (value: string | undefined, fallback = 0): number => {
  const parsed = Number.parseInt(value || '', 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

export const parseJsonFromRedis = <T>(value: string | undefined, fallback: T): T => {
  if (!value) return fallback
  try { return JSON.parse(value) as T } catch { return fallback }
}

export const expireDoclingAsyncKeys = async (fileId: string, totalParts: number): Promise<void> => {
  const client = getClient()
  const ttl = config.doclingScheduler.resultBlockMs / 1000 // convert ms to s (or use a dedicated config)
  const keys = [doclingAsyncFileKey(fileId)]
  for (let i = 0; i < totalParts; i++) {
    keys.push(doclingAsyncPartKey(fileId, i))
    keys.push(doclingAsyncPartResultKey(fileId, i))
  }
  await Promise.all(keys.map((key) => client.expire(key, Math.max(ttl, 3600))))
}

export const getDoclingAsyncFileState = async (fileId: string): Promise<Partial<DoclingAsyncFileState> | null> => {
  const state = await getClient().hgetall(doclingAsyncFileKey(fileId)) as Partial<DoclingAsyncFileState>
  return Object.keys(state).length > 0 ? state : null
}

export const setDoclingAsyncFileState = async (state: DoclingAsyncFileState): Promise<void> => {
  const client = getClient()
  await client.hset(doclingAsyncFileKey(state.fileId), state as unknown as Record<string, string>)
  await client.expire(doclingAsyncFileKey(state.fileId), 3600 * 48)
}

export const patchDoclingAsyncFileState = async (fileId: string, updates: Partial<DoclingAsyncFileState>): Promise<void> => {
  const client = getClient()
  await client.hset(doclingAsyncFileKey(fileId), { ...updates, updatedAt: new Date().toISOString() } as unknown as Record<string, string>)
  await client.expire(doclingAsyncFileKey(fileId), 3600 * 48)
}

export const getDoclingAsyncPartState = async (fileId: string, partIndex: number): Promise<Partial<DoclingAsyncPartState> | null> => {
  const state = await getClient().hgetall(doclingAsyncPartKey(fileId, partIndex)) as Partial<DoclingAsyncPartState>
  return Object.keys(state).length > 0 ? state : null
}

export const patchDoclingAsyncPartState = async (fileId: string, partIndex: number, updates: Partial<DoclingAsyncPartState>): Promise<void> => {
  const client = getClient()
  await client.hset(doclingAsyncPartKey(fileId, partIndex), { ...updates, updatedAt: new Date().toISOString() } as unknown as Record<string, string>)
  await client.expire(doclingAsyncPartKey(fileId, partIndex), 3600 * 48)
}

export const putDoclingAsyncPartResult = async (fileId: string, partIndex: number, result: unknown): Promise<void> => {
  await getClient().set(doclingAsyncPartResultKey(fileId, partIndex), JSON.stringify(result), 'EX', 3600 * 48)
}

export const getDoclingAsyncPartResult = async <T>(fileId: string, partIndex: number): Promise<T | null> => {
  const payload = await getClient().get(doclingAsyncPartResultKey(fileId, partIndex))
  return payload ? (JSON.parse(payload) as T) : null
}

export const deleteDoclingAsyncPartResult = async (fileId: string, partIndex: number): Promise<void> => {
  await getClient().del(doclingAsyncPartResultKey(fileId, partIndex))
}

export const deleteDoclingAsyncPartState = async (fileId: string, partIndex: number): Promise<void> => {
  await getClient().del([doclingAsyncPartKey(fileId, partIndex), doclingAsyncPartResultKey(fileId, partIndex)])
}

export const listDoclingAsyncPartIndexes = async (fileId: string): Promise<number[]> => {
  const client = getClient()
  const match = `${doclingAsyncFileKey(fileId)}:part:*`
  const indexes = new Set<number>()
  let cursor = '0'
  do {
    const [next, keys] = await client.scan(cursor, 'MATCH', match, 'COUNT', 100)
    cursor = next
    for (const key of keys) {
      const matched = key.match(/:part:(\d+)$/)
      if (matched) indexes.add(Number.parseInt(matched[1] || '', 10))
    }
  } while (cursor !== '0')
  return [...indexes].sort((a, b) => a - b)
}
