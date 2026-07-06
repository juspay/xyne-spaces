/**
 * Result worker: reads OCR completion events from the Redis stream,
 * fetches the result payload, stores it in the local staging filesystem,
 * and marks the Postgres part row as Ready for the writer to pick up.
 *
 * Ported from xyne-spaces doclingScheduler/workers.ts — the result worker
 * section extracted for xyne-search structural parity.
 */
import { config } from '@/config/env'
import { logger } from '@/utils/logger'
import { DOCLING_PART_STATUS } from '../types'
import {
  failDoclingFile,
  getDoclingPartsForFile,
  getDoclingPartByJobId,
  markDoclingPartReady,
  markDoclingPartSubmitRetry,
} from '../scheduler/store'
import {
  releaseDoclingSchedulerPermit,
} from '../runtime/submitPermits'
import {
  type DoclingResultEvent,
  ensureResultConsumerGroup,
  readResultEvents,
  claimStaleResultEvents,
  ackResultEvent,
  getResultPayload,
  createBlockingRedisConnection,
} from '../scheduler/permits'
import { resultKey, writeJson } from '../scheduler/storage'
import { processingResultFromDoclingResponse, type DoclingResponse } from './resultMapping'
import { runSyncFallbackForFailedFile } from '../../processors/syncFallback'

const sched = () => config.doclingScheduler
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const retryDelay = (attempt: number) =>
  Math.min(sched().retryMaxMs, sched().retryBaseMs * Math.max(attempt, 1))
const workerId = (role: string) =>
  `${role}:${process.env.HOSTNAME || 'local'}:${process.pid}:${Math.random().toString(36).slice(2)}`

const releaseOcrPermitsForFile = async (fileId: string) => {
  const parts = await getDoclingPartsForFile(fileId)
  for (const part of parts) {
    if (part.submitPermitId) {
      await releaseDoclingSchedulerPermit({ kind: 'ocr-submit', permitId: part.submitPermitId })
    }
  }
}

const failSchedulerFile = async (fileId: string, message: string) => {
  await releaseOcrPermitsForFile(fileId)
  if (config.pdf?.asyncSyncFallbackEnabled) {
    const recovered = await runSyncFallbackForFailedFile(fileId, message)
    if (recovered) {
      logger.info('[DOCLING_SCHEDULER] file recovered via sync fallback', { fileId })
      return
    }
  }
  await failDoclingFile(fileId, message)
}

const handleResultEvent = async (event: DoclingResultEvent) => {
  const jobId = event.jobId
  if (!jobId) return
  const part = await getDoclingPartByJobId(jobId)
  if (!part) return
  const t1 = part.submittedAt ? part.submittedAt.getTime() : null
  const t2 = Date.now()
  const ocrMs = t1 !== null ? t2 - t1 : null

  if (
    part.status !== DOCLING_PART_STATUS.Submitting &&
    part.status !== DOCLING_PART_STATUS.Submitted
  ) {
    if (part.submitPermitId) {
      await releaseDoclingSchedulerPermit({ kind: 'ocr-submit', permitId: part.submitPermitId })
    }
    return // duplicate / stale
  }

  if (event.status === 'failed') {
    if (part.submitPermitId) {
      await releaseDoclingSchedulerPermit({ kind: 'ocr-submit', permitId: part.submitPermitId })
    }
    const message = event.error || 'unknown OCR failure'
    logger.warn('[DOCLING_SCHEDULER_METRICS][result] OCR failed', {
      fileId: part.fileId,
      partIndex: part.partIndex,
      jobId,
      ocrMs,
      attemptCount: part.attemptCount,
      error: message,
    })
    if (part.attemptCount >= sched().maxPartAttempts) {
      await failSchedulerFile(
        part.fileId,
        `OCR failed for part ${part.partIndex} after ${part.attemptCount} attempts: ${message}`,
      )
    } else {
      await markDoclingPartSubmitRetry({
        fileId: part.fileId,
        partIndex: part.partIndex,
        jobId,
        errorMessage: message,
        availableAt: new Date(Date.now() + retryDelay(part.attemptCount)),
      })
    }
    return
  }

  if (event.status !== 'ok') {
    throw new Error(`Unsupported OCR result status=${event.status}`)
  }
  if (!event.resultKey) {
    throw new Error(`Missing result_key for event ${event.id}`)
  }
  const payload = await getResultPayload(event.resultKey)
  if (!payload) {
    throw new Error(`Missing OCR result payload at ${event.resultKey}`)
  }

  const doclingResponse = JSON.parse(payload) as DoclingResponse
  const result = processingResultFromDoclingResponse(doclingResponse)
  const path = resultKey(part.fileId, part.partIndex)
  await writeJson(path, result)
  await markDoclingPartReady({
    fileId: part.fileId,
    partIndex: part.partIndex,
    jobId,
    resultPath: path,
  })
  if (part.submitPermitId) {
    await releaseDoclingSchedulerPermit({ kind: 'ocr-submit', permitId: part.submitPermitId })
  }
  logger.info('[DOCLING_SCHEDULER_METRICS][result] OCR result stored → part ready', {
    fileId: part.fileId,
    partIndex: part.partIndex,
    jobId,
    chunks: result.chunks.length,
    ocrMs,
  })
}

export const startResultWorker = async (): Promise<void> => {
  await ensureResultConsumerGroup()
  const conn = createBlockingRedisConnection()
  const consumerName = workerId('result')
  for (;;) {
    let events = await claimStaleResultEvents(consumerName)
    if (events.length === 0) {
      events = await readResultEvents(conn, consumerName)
    }
    for (const event of events) {
      try {
        await handleResultEvent(event)
        await ackResultEvent(event.id)
      } catch (error) {
        logger.error('[DOCLING_SCHEDULER] failed to process result event', {
          id: event.id,
          jobId: event.jobId,
          error: errMsg(error),
        })
      }
    }
  }
}
