/**
 * Live-tunable runtime config for the async OCR scheduler.
 * Polled from a Redis hash so operators can adjust concurrency / budget
 * without a restart. Falls back to env-derived defaults on Redis error.
 */
import { redisService } from '@/services/redisService'
import { config } from '@/config/env'
import { logger } from '@/utils/logger'

const sched = () => config.doclingScheduler

export interface DoclingRuntimeConfig {
  submitPermits: number
  activeOcrFiles: number
  admittedPageBudget: number
  perFileInflightParts: number
  perFileInflightPages: number
  submitterConcurrencyPerContainer: number
  splitterConcurrency: number
  vespaWritePermits: number
  pageChunkSize: number
  version: string | null
  updatedAt: string | null
  source: 'defaults' | 'redis'
}

const defaultRuntimeConfig = (): DoclingRuntimeConfig => ({
  submitPermits: sched().submitPermits,
  activeOcrFiles: sched().activeOcrFiles,
  admittedPageBudget: sched().admittedPageBudget,
  perFileInflightParts: sched().perFileInflightParts,
  perFileInflightPages: sched().perFileInflightPages,
  submitterConcurrencyPerContainer: sched().submitConcurrency,
  splitterConcurrency: sched().splitConcurrency,
  vespaWritePermits: sched().vespaWritePermits,
  pageChunkSize: sched().pageChunkSize,
  version: null,
  updatedAt: null,
  source: 'defaults',
})

let currentRuntimeConfig: DoclingRuntimeConfig = defaultRuntimeConfig()
let pollTimer: NodeJS.Timeout | null = null
let pollingStarted = false

const positiveInt = (raw: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(raw || '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export const getRuntimeConfig = (): DoclingRuntimeConfig => currentRuntimeConfig

export const refreshRuntimeConfig = async (): Promise<DoclingRuntimeConfig> => {
  try {
    const payload = await redisService.getClient().hgetall(sched().runtimeConfigKey)
    const base = defaultRuntimeConfig()
    if (payload && Object.keys(payload).length > 0) {
      const pageChunkSize = positiveInt(payload.page_chunk_size, base.pageChunkSize)
      const perFileInflightParts = positiveInt(payload.per_file_inflight_parts, base.perFileInflightParts)
      currentRuntimeConfig = {
        submitPermits: positiveInt(payload.submit_permits, base.submitPermits),
        activeOcrFiles: positiveInt(payload.active_ocr_files, base.activeOcrFiles),
        admittedPageBudget: positiveInt(payload.admitted_page_budget, base.admittedPageBudget),
        perFileInflightParts,
        perFileInflightPages: positiveInt(
          payload.per_file_inflight_pages,
          perFileInflightParts * pageChunkSize,
        ),
        submitterConcurrencyPerContainer: positiveInt(
          payload.submitter_concurrency_per_container || payload.submitter_concurrency,
          base.submitterConcurrencyPerContainer,
        ),
        splitterConcurrency: positiveInt(payload.splitter_concurrency, base.splitterConcurrency),
        vespaWritePermits: positiveInt(payload.vespa_write_permits, base.vespaWritePermits),
        pageChunkSize,
        version: payload.version || null,
        updatedAt: payload.updated_at || null,
        source: 'redis',
      }
    } else {
      currentRuntimeConfig = base
    }
  } catch (error) {
    logger.warn('[DOCLING_SCHEDULER] Failed to refresh runtime config; keeping previous', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
  return currentRuntimeConfig
}

export const startRuntimeConfigPolling = (): void => {
  if (pollingStarted) return
  pollingStarted = true
  void refreshRuntimeConfig()
  const schedule = () => {
    pollTimer = setTimeout(async () => {
      pollTimer = null
      await refreshRuntimeConfig()
      if (pollingStarted) schedule()
    }, sched().runtimeConfigPollMs)
    pollTimer.unref?.()
  }
  schedule()
}

export const stopRuntimeConfigPolling = (): void => {
  pollingStarted = false
  if (pollTimer) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
}
