/**
 * Submits a staged PDF page-part to the LightOn OCR wrapper's /process_async.
 * Fire-and-forget: the wrapper OCRs the part and publishes the result to Redis.
 *
 * Adapted from xyne-search (Bun fetch → Node fetch with AbortController timeout).
 */
import { config } from '@/config/env'
import { logger } from '@/utils/logger'

export interface SubmitDoclingAsyncJobInput {
  buffer: Buffer
  fileName: string
  jobId: string
  fileId: string
  docId: string
  vespaDocId: string
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const retryAfterMs = (response: Response): number | null => {
  const retryAfter = response.headers.get('retry-after')
  if (!retryAfter) return null
  const seconds = Number.parseInt(retryAfter, 10)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  const retryAt = Date.parse(retryAfter)
  if (Number.isFinite(retryAt)) return Math.max(retryAt - Date.now(), 0)
  return null
}

export const submitDoclingAsyncJob = async (input: SubmitDoclingAsyncJobInput): Promise<unknown> => {
  const sched = config.doclingScheduler
  const retries = Math.max(sched.submitRetries, 1)
  const baseDelay = sched.submitRetryDelayMs
  const timeoutMs = sched.submitTimeoutMs
  const apiUrl = `${sched.serviceUrl.replace(/\/+$/, '')}/process_async`
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= retries; attempt++) {
    let submitTimer: ReturnType<typeof setTimeout> | null = null
    const formData = new FormData()
    const blob = new Blob([input.buffer as unknown as Uint8Array], { type: 'application/pdf' })
    formData.append('file', blob, input.fileName)
    formData.append('job_id', input.jobId)
    formData.append('file_id', input.fileId)
    formData.append('doc_id', input.docId)
    formData.append('vespa_doc_id', input.vespaDocId)

    try {
      const controller = new AbortController()
      submitTimer = setTimeout(() => controller.abort(), timeoutMs)
      const response = await fetch(apiUrl, { method: 'POST', body: formData, signal: controller.signal })
      clearTimeout(submitTimer)
      submitTimer = null

      if (response.ok) {
        return await response.json().catch(() => ({ status: 'accepted', job_id: input.jobId }))
      }

      const body = await response.text().catch(() => '')
      const retriable = response.status === 429 || response.status >= 500
      const retryDelayMs = response.status === 429 ? retryAfterMs(response) ?? baseDelay * attempt : baseDelay * attempt
      lastError = new Error(`Docling async submit failed: ${response.status} ${response.statusText} ${body.slice(0, 300)}`)
      if (!retriable || attempt === retries) throw lastError

      logger.warn('[DOCLING] Async submit rejected; retrying', {
        jobId: input.jobId, fileId: input.fileId, status: response.status, attempt, retryDelayMs,
      })
      await sleep(retryDelayMs)
    } catch (error) {
      if (submitTimer) { clearTimeout(submitTimer); submitTimer = null }
      lastError = error instanceof Error ? error : new Error(String(error))
      if (attempt === retries) break
      logger.warn('[DOCLING] Async submit error; retrying', {
        jobId: input.jobId, fileId: input.fileId, attempt, error: lastError.message,
      })
      await sleep(baseDelay * attempt)
    }
  }

  throw lastError ?? new Error('Docling async submit failed')
}
