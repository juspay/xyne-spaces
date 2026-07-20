/**
 * The async OCR scheduler roles: splitter, submitter, writer, reaper.
 * (The result worker is in ./result.ts)
 *
 * Ported from xyne-search. Adapted for:
 *  - Postgres state machine via Prisma (scheduler/store.ts)
 *  - ioredis (runtime/submitPermits.ts)
 *  - GCS staging (scheduler/storage.ts)
 *  - xyne-spaces Vespa client (vespaClient.crudService.insert)
 */
import { randomUUID } from 'node:crypto';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { runWithContext } from '@/database/tenant/context';
import vespaClient from '@/vespa/client';
import { fileSchema, type InsertDocument } from '@/vespa/src/types';
import { runSyncFallbackForFailedFile } from '../../processors/syncFallback';
import {
  DOCLING_FILE_STATUS,
  type DoclingPart,
  type ProcessingResult,
  type SchedulerChunkMeta,
} from '../types';
import {
  admitDoclingOcrFiles,
  claimDoclingPartsForSubmitBatch,
  claimNextDoclingFileToSplit,
  claimNextDoclingFileToWrite,
  failDoclingFile,
  failDoclingFileIfOwned,
  getDoclingFile,
  getDoclingPartsForFile,
  listDeletedActiveDoclingFileIds,
  listExpiredSubmittingDoclingParts,
  listLiveDoclingCurrentJobIds,
  listLiveDoclingSubmitPermitIds,
  listTimedOutSubmittedDoclingParts,
  markDoclingFileCompleted,
  markDoclingFileSplitComplete,
  markDoclingFileSplitRetry,
  markDoclingFileWriteRetry,
  markDoclingPartSubmitRetry,
  markDoclingPartSubmitted,
  releaseClaimedDoclingPartForSubmitCapacity,
  requeueExpiredDoclingLeases,
} from '../scheduler/store';
import { getRuntimeConfig } from '../runtime/config';
import {
  listActiveDoclingSchedulerPermitIds as listActivePermitIds,
  releaseDoclingSchedulerPermit as releasePermit,
  tryAcquireDoclingSchedulerPermit as tryAcquirePermit,
  tryAcquireDoclingSchedulerWeightedPermit as tryAcquireWeightedPermit,
  type DoclingSchedulerPermit,
} from '../runtime/submitPermits';
import { readBuffer, readJson, cleanupStage, readSourceBuffer } from '../scheduler/storage';
import { stagePdfParts } from '../scheduler/pdfSplitter';
import { submitDoclingAsyncJob } from '../runtime/client';

const sched = () => config.doclingScheduler;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const retryDelay = (attempt: number) =>
  Math.min(sched().retryMaxMs, sched().retryBaseMs * Math.max(attempt, 1));

const submittedPartTimeoutMs = () =>
  Math.max(sched().submitPermitLeaseTtlMs, sched().leaseMs);

const workerId = (role: string) =>
  `${role}:${process.env.HOSTNAME || 'local'}:${process.pid}:${randomUUID()}`;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

class TerminalDoclingSchedulerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TerminalDoclingSchedulerError';
  }
}

const isTerminalDoclingSchedulerError = (error: unknown): error is TerminalDoclingSchedulerError =>
  error instanceof TerminalDoclingSchedulerError ||
  (error instanceof Error && error.name === 'TerminalDoclingSchedulerError');

// GCS throws "File does not exist in GCS: <path>" for missing objects.
const isMissingSourceFileError = (message: string) =>
  message.includes('does not exist in GCS') ||
  message.includes('ENOENT') ||
  message.includes('No such file or directory');

interface SchedulerFileContext {
  vespaDocId: string;
  fileName: string;
  mimeType: string;
}

const getSchedulerFileContext = async (file: {
  fileId: string;
  collectionId: string;
}): Promise<SchedulerFileContext> => {
  if (file.collectionId !== '') {
    const item = await db.collectionItem.findFirst({
      where: { fileId: file.fileId, isLatest: true },
    });
    if (!item) throw new TerminalDoclingSchedulerError(`No collection item for fileId=${file.fileId}`);
    if (item.deletedAt) throw new TerminalDoclingSchedulerError(`Collection item deleted for fileId=${file.fileId}`);
    return { vespaDocId: item.fileId, fileName: item.name, mimeType: 'application/pdf' };
  }
  const att = await db.messageAttachment.findUnique({ where: { id: file.fileId } });
  if (!att) throw new TerminalDoclingSchedulerError(`No message attachment for id=${file.fileId}`);
  return {
    vespaDocId: att.id,
    fileName: att.originalFilename || att.id,
    mimeType: att.mimetype || 'application/pdf',
  };
};

const wrapperGlobalActiveKey =
  process.env.DOCLING_WRAPPER_GLOBAL_ACTIVE_KEY || 'docling:async:global:active';

// ── AsyncWorkQueue (prefetch queue for submitter) ────────────────────────────

class AsyncWorkQueue<T> {
  private items: T[] = [];
  private waiters: Array<(value: T | null) => void> = [];

  size() {
    return this.items.length;
  }

  push(item: T) {
    const waiter = this.waiters.shift();
    if (waiter) { waiter(item); return; }
    this.items.push(item);
  }

  pushFront(item: T) {
    const waiter = this.waiters.shift();
    if (waiter) { waiter(item); return; }
    this.items.unshift(item);
  }

  popNewest() {
    return this.items.pop() || null;
  }

  async take(timeoutMs: number): Promise<T | null> {
    const existing = this.items.shift();
    if (existing) return existing;
    return new Promise<T | null>((resolve) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.indexOf(waiter);
        if (idx >= 0) this.waiters.splice(idx, 1);
        resolve(null);
      }, timeoutMs);
      const waiter = (value: T | null) => { clearTimeout(timer); resolve(value); };
      this.waiters.push(waiter);
    });
  }
}

// ── SubmitterTelemetry ───────────────────────────────────────────────────────

type TimingBucket = { count: number; totalMs: number; maxMs: number };
const mkBucket = (): TimingBucket => ({ count: 0, totalMs: 0, maxMs: 0 });

class SubmitterTelemetry {
  private lastInfoLogAt = 0;
  private loops = 0;
  private emptyClaims = 0;
  private claimedParts = 0;
  private claimedPages = 0;
  private releasedUnusedPermits = 0;
  private queueTrimmed = 0;
  private timings = {
    admitMs: mkBucket(),
    requestPermitAcquireMs: mkBucket(),
    claimMs: mkBucket(),
    pagePermitAcquireMs: mkBucket(),
    queueWaitMs: mkBucket(),
    readPartMs: mkBucket(),
    submitMs: mkBucket(),
    markSubmittedMs: mkBucket(),
    totalProcessMs: mkBucket(),
  };

  recordTiming(name: keyof SubmitterTelemetry['timings'], ms: number) {
    const b = this.timings[name];
    b.count += 1; b.totalMs += ms; b.maxMs = Math.max(b.maxMs, ms);
  }

  recordClaimed(parts: { pageCount: number }[]) {
    this.claimedParts += parts.length;
    this.claimedPages += parts.reduce((s, p) => s + p.pageCount, 0);
  }

  recordUnusedPermits(n: number) { this.releasedUnusedPermits += Math.max(n, 0); }
  recordEmptyClaim() { this.emptyClaims += 1; }
  recordQueueTrimmed(n: number) { this.queueTrimmed += Math.max(n, 0); }
  recordLoop() { this.loops += 1; }

  maybeLogSnapshot(input: {
    supervisorId: string;
    desiredConcurrency: number;
    activeProcessing: number;
    queueLength: number;
    localCapacity: number;
  }) {
    const now = Date.now();
    if (now - this.lastInfoLogAt < 10_000) return;
    this.lastInfoLogAt = now;
    const avg = (b: TimingBucket) => b.count > 0 ? Math.round(b.totalMs / b.count) : 0;
    logger.info('[DOCLING_SCHEDULER][submitter] timing snapshot', {
      workerId: input.supervisorId,
      desiredConcurrency: input.desiredConcurrency,
      activeProcessing: input.activeProcessing,
      queueLength: input.queueLength,
      localCapacity: input.localCapacity,
      loops: this.loops,
      emptyClaims: this.emptyClaims,
      claimedParts: this.claimedParts,
      claimedPages: this.claimedPages,
      releasedUnusedPermits: this.releasedUnusedPermits,
      queueTrimmed: this.queueTrimmed,
      admitMsAvg: avg(this.timings.admitMs),
      requestPermitMsAvg: avg(this.timings.requestPermitAcquireMs),
      claimMsAvg: avg(this.timings.claimMs),
      pagePermitMsAvg: avg(this.timings.pagePermitAcquireMs),
      queueWaitMsAvg: avg(this.timings.queueWaitMs),
      readPartMsAvg: avg(this.timings.readPartMs),
      submitMsAvg: avg(this.timings.submitMs),
      markSubmittedMsAvg: avg(this.timings.markSubmittedMs),
      totalProcessMsAvg: avg(this.timings.totalProcessMs),
    });
  }
}

const timed = async <T>(fn: () => Promise<T>) => {
  const start = Date.now();
  const value = await fn();
  return { value, elapsedMs: Date.now() - start };
};

// ── Dynamic worker pool (resizes to desired concurrency) ─────────────────────

interface WorkerControl {
  stopRequested: boolean;
  promise: Promise<void>;
}

const startDynamicRolePool = async (input: {
  role: string;
  getDesiredConcurrency: () => number;
  runWorker: (workerName: string, shouldStop: () => boolean) => Promise<void>;
  shouldStop?: () => boolean;
}): Promise<void> => {
  const workers = new Map<string, WorkerControl>();
  let nextIndex = 0;
  const active = () => Array.from(workers.values()).filter((w) => !w.stopRequested);

  const launch = () => {
    const name = workerId(`${input.role}-${nextIndex++}`);
    const control: WorkerControl = { stopRequested: false, promise: Promise.resolve() };
    workers.set(name, control);
    control.promise = input
      .runWorker(name, () => control.stopRequested)
      .catch((error) => {
        logger.error('[DOCLING_SCHEDULER] worker exited unexpectedly', {
          role: input.role,
          name,
          error: errMsg(error),
        });
      })
      .finally(() => {
        workers.delete(name);
      });
  };

  for (;;) {
    if (input.shouldStop?.()) {
      for (const w of workers.values()) w.stopRequested = true;
      await Promise.allSettled(Array.from(workers.values()).map((w) => w.promise));
      return;
    }
    const desired = Math.max(input.getDesiredConcurrency(), 1);
    while (active().length < desired) launch();
    if (active().length > desired) {
      for (const w of workers.values()) {
        if (active().length <= desired) break;
        if (!w.stopRequested) w.stopRequested = true;
      }
    }
    await sleep(sched().pollMs);
  }
};

// ── Shared helpers ───────────────────────────────────────────────────────────

const releaseOcrPermitsForFile = async (fileId: string) => {
  const parts = await getDoclingPartsForFile(fileId);
  const permitIds = new Set(
    parts.map((p) => p.submitPermitId).filter((id): id is string => Boolean(id)),
  );
  for (const permitId of permitIds) {
    await releasePermit({ kind: 'ocr-submit', permitId });
  }
};

export const failSchedulerFile = async (fileId: string, message: string) => {
  await releaseOcrPermitsForFile(fileId);
  // Before giving up, try the synchronous fallback ladder (Docling/PdfJs) on the
  // same source PDF — degrade gracefully instead of dropping the file.
  if (config.pdf.asyncSyncFallbackEnabled) {
    const recovered = await runSyncFallbackForFailedFile(fileId, message);
    if (recovered) {
      logger.info(
        '[DOCLING_SCHEDULER] file recovered via sync fallback instead of failing',
        { fileId },
      );
      return;
    }
  }
  await failDoclingFile(fileId, message);
};

const offsetMeta = (
  meta: SchedulerChunkMeta,
  chunkIndex: number,
  pageOffset: number,
): SchedulerChunkMeta => ({
  chunk_index: chunkIndex,
  page_numbers: (meta.page_numbers || []).map((p) => p + pageOffset),
  block_labels: meta.block_labels || [],
});

/** Read every part's staged result JSON and stitch them into one document. */
const aggregatePartResults = async (parts: DoclingPart[]) => {
  const chunks: string[] = [];
  const imageChunks: string[] = [];
  const tocChunks: string[] = [];
  const chunksMap: SchedulerChunkMeta[] = [];
  const imageChunksMap: SchedulerChunkMeta[] = [];

  const ordered = [...parts].sort((a, b) => a.partIndex - b.partIndex);
  for (const part of ordered) {
    if (!part.resultPath) {
      throw new Error(`Missing result path for file=${part.fileId} part=${part.partIndex}`);
    }
    const result = await readJson<ProcessingResult>(part.resultPath);
    const textOffset = chunks.length;
    const imageOffset = imageChunks.length;
    chunks.push(...result.chunks);
    imageChunks.push(...result.image_chunks);
    tocChunks.push(...(result.toc_chunks || []));
    chunksMap.push(
      ...(result.chunks_map || []).map((m, i) =>
        offsetMeta(m, textOffset + i, part.startPage),
      ),
    );
    imageChunksMap.push(
      ...(result.image_chunks_map || []).map((m, i) =>
        offsetMeta(m, imageOffset + i, part.startPage),
      ),
    );
  }

  return {
    chunks,
    chunks_pos: chunks.map((_, i) => String(i)),
    image_chunks: imageChunks,
    image_chunks_pos: imageChunks.map((_, i) => String(i)),
    toc_chunks: tocChunks,
    chunks_map: chunksMap,
    image_chunks_map: imageChunksMap,
  };
};

const isRetryableVespaError = (error: unknown) => {
  const m = errMsg(error).toLowerCase();
  return (
    m.includes('429') ||
    m.includes('timeout') ||
    m.includes('timed out') ||
    m.includes('econnreset') ||
    m.includes('503') ||
    m.includes('502') ||
    m.includes('504')
  );
};

// ── Splitter ─────────────────────────────────────────────────────────────────

const runSplitterWorker = async (id: string, shouldStop: () => boolean) => {
  for (;;) {
    if (shouldStop()) return;
    const file = await claimNextDoclingFileToSplit(id, sched().leaseMs);
    if (!file) {
      await sleep(sched().pollMs);
      continue;
    }
    logger.info('[DOCLING_SCHEDULER][splitter] claimed file → splitting', {
      fileId: file.fileId,
      source: file.sourceStorageKey || file.sourcePath,
    });
    try {
      const ctx = await getSchedulerFileContext(file);

      const t1 = Date.now();
      const sourceBuffer = await readSourceBuffer(file.sourceStorageKey || file.sourcePath);
      const t2 = Date.now();
      logger.info('[DOCLING_SCHEDULER_METRICS][splitter] gcs read complete', {
        fileId: file.fileId,
        gcsReadMs: t2 - t1,
        bytes: sourceBuffer.length,
      });

      const t3 = Date.now();
      const stagedParts = await stagePdfParts({
        fileId: file.fileId,
        sourceBuffer,
        vespaDocId: ctx.vespaDocId,
        fileName: ctx.fileName,
        pageChunkSize: getRuntimeConfig().pageChunkSize,
      });
      const t4 = Date.now();
      logger.info('[DOCLING_SCHEDULER_METRICS][splitter] split complete', {
        fileId: file.fileId,
        splitMs: t4 - t3,
        parts: stagedParts.partsTotal,
        totalPages: stagedParts.totalPages,
      });

      // Stamp docling_async_parts with the file's tenant. Background worker has no
      // request-scoped context, so open one from the denormalized file.workspaceId
      // (populated at intake). Fall back to an unscoped run when it's absent.
      const commitSplit = () => markDoclingFileSplitComplete(
        file,
        stagedParts,
        stagedParts.stageDir + '/results',
      );
      const committed = file.workspaceId
        ? await runWithContext(
            { userId: 'docling-splitter', workspaceId: file.workspaceId },
            commitSplit,
          )
        : await commitSplit();
      if (!committed) {
        logger.warn('[DOCLING_SCHEDULER] Ignoring stale split completion (lease changed)', {
          fileId: file.fileId,
        });
      } else {
        logger.info('[DOCLING_SCHEDULER][splitter] queued_for_ocr', {
          fileId: file.fileId,
          gcsReadMs: t2 - t1,
          splitMs: t4 - t3,
          parts: stagedParts.partsTotal,
          totalPages: stagedParts.totalPages,
        });
      }
    } catch (error) {
      const message = errMsg(error);
      logger.error('[DOCLING_SCHEDULER] split failed', { fileId: file.fileId, error: message });
      const nextAttempt = file.splitAttemptCount + 1;
      if (isTerminalDoclingSchedulerError(error) || isMissingSourceFileError(message) || nextAttempt >= sched().maxSplitAttempts) {
        await failDoclingFileIfOwned(
          file,
          'splitting',
          `Docling split failed after ${nextAttempt} attempts: ${message}`,
        );
      } else {
        await markDoclingFileSplitRetry(file, message, new Date(Date.now() + retryDelay(nextAttempt)));
      }
    }
  }
};

export const startSplitter = () =>
  startDynamicRolePool({
    role: 'splitter',
    getDesiredConcurrency: () => getRuntimeConfig().splitterConcurrency,
    runWorker: runSplitterWorker,
  });

// ── Submitter (3-component: admission coordinator + claimer + processor) ─────

type ClaimedSubmitWork = {
  part: DoclingPart;
  requestPermit: DoclingSchedulerPermit;
  claimedAt: number;
};

type SubmitterSupervisorState = {
  supervisorId: string;
  queue: AsyncWorkQueue<ClaimedSubmitWork>;
  telemetry: SubmitterTelemetry;
  activeProcessing: number;
  reservedProcessing: number;
};

const getSubmitterDesiredConcurrency = () =>
  Math.max(getRuntimeConfig().submitterConcurrencyPerContainer ?? sched().submitConcurrency ?? 4, 1);

const getSubmitterPrefetchCapacity = (desired: number) =>
  Math.floor(desired * (sched().submitPrefetchMultiplier ?? 2));

const getSubmitterLocalCapacity = (desired: number) =>
  desired + getSubmitterPrefetchCapacity(desired);

const releaseQueuedSubmitWork = async (work: ClaimedSubmitWork, errorMessage: string) => {
  await releasePermit(work.requestPermit);
  if (!work.part.currentJobId) {
    await failSchedulerFile(work.part.fileId, 'Queued claimed OCR part lost current job id');
    return;
  }
  await releaseClaimedDoclingPartForSubmitCapacity({
    fileId: work.part.fileId,
    partIndex: work.part.partIndex,
    jobId: work.part.currentJobId,
    errorMessage,
    availableAt: new Date(Date.now() + sched().pollMs),
  });
};

const trimSubmitterQueueToCapacity = async (state: SubmitterSupervisorState) => {
  const desired = getSubmitterDesiredConcurrency();
  const capacity = getSubmitterLocalCapacity(desired);
  const allowed = Math.max(capacity - state.activeProcessing, 0);
  let trimmed = 0;
  while (state.queue.size() > allowed) {
    const work = state.queue.popNewest();
    if (!work) break;
    trimmed += 1;
    await releaseQueuedSubmitWork(work, 'Submitter runtime downscaled before queued OCR submit started');
  }
  if (trimmed > 0) {
    state.telemetry.recordQueueTrimmed(trimmed);
    logger.warn('[DOCLING_SCHEDULER][submitter] trimmed queued work after downscale', {
      workerId: state.supervisorId, trimmed, desired, capacity,
    });
  }
};

const runSubmitterAdmissionCoordinator = async (
  state: SubmitterSupervisorState,
  shouldStop: () => boolean,
) => {
  while (true) {
    if (shouldStop()) return;
    try {
      const rc = getRuntimeConfig();
      if (rc.activeOcrFiles > 0 && rc.admittedPageBudget > 0) {
        const { elapsedMs } = await timed(() =>
          admitDoclingOcrFiles({
            activeFileLimit: rc.activeOcrFiles,
            admittedPageBudget: rc.admittedPageBudget,
          }),
        );
        state.telemetry.recordTiming('admitMs', elapsedMs);
      }
      state.telemetry.maybeLogSnapshot({
        supervisorId: state.supervisorId,
        desiredConcurrency: getSubmitterDesiredConcurrency(),
        activeProcessing: state.activeProcessing,
        queueLength: state.queue.size(),
        localCapacity: getSubmitterLocalCapacity(getSubmitterDesiredConcurrency()),
      });
    } catch (error) {
      logger.error('[DOCLING_SCHEDULER][submitter] admission coordinator error', {
        workerId: state.supervisorId, error: errMsg(error),
      });
    }
    await sleep(sched().admissionPollMs ?? sched().pollMs);
  }
};

const acquireRequestPermitBatch = async (owner: string, capacity: number, count: number) => {
  const permits: DoclingSchedulerPermit[] = [];
  for (let i = 0; i < count; i++) {
    const p = await tryAcquirePermit({
      kind: 'ocr-submit', capacity, ttlMs: sched().submitPermitLeaseTtlMs, owner,
    });
    if (!p) break;
    permits.push(p);
  }
  return permits;
};

const runSubmitterClaimer = async (
  id: string,
  state: SubmitterSupervisorState,
  shouldStop: () => boolean,
) => {
  while (true) {
    if (shouldStop()) return;
    try {
      await trimSubmitterQueueToCapacity(state);
      const rc = getRuntimeConfig();
      const desired = Math.max(rc.submitterConcurrencyPerContainer ?? sched().submitConcurrency ?? 4, 1);
      const capacity = getSubmitterLocalCapacity(desired);
      const free = Math.max(capacity - state.activeProcessing - state.queue.size(), 0);
      if (free <= 0) {
        await sleep(sched().pollMs);
        continue;
      }
      const batchSize = Math.max(1, Math.min(sched().submitClaimBatchSize ?? 4, free, 100));
      const { value: permits, elapsedMs: permitMs } = await timed(() =>
        acquireRequestPermitBatch(id, rc.submitPermits, batchSize),
      );
      state.telemetry.recordTiming('requestPermitAcquireMs', permitMs);
      if (permits.length === 0) {
        await sleep(sched().pollMs);
        continue;
      }
      const { value: claimedParts, elapsedMs: claimMs } = await timed(() =>
        claimDoclingPartsForSubmitBatch({
          workerId: id,
          permitIds: permits.map((p) => p.permitId),
          leaseMs: sched().leaseMs,
          perFileInflightPages: rc.perFileInflightPages ?? rc.perFileInflightParts,
          admittedPageBudget: rc.admittedPageBudget,
          maxParts: batchSize,
        }),
      );
      state.telemetry.recordTiming('claimMs', claimMs);
      state.telemetry.recordLoop();

      const claimedPermitIds = new Set(
        claimedParts.map((p) => p.submitPermitId).filter((id): id is string => Boolean(id)),
      );
      const unusedPermits = permits.filter((p) => !claimedPermitIds.has(p.permitId));
      if (unusedPermits.length > 0) {
        await Promise.all(unusedPermits.map((p) => releasePermit(p)));
        state.telemetry.recordUnusedPermits(unusedPermits.length);
      }

      if (claimedParts.length === 0) {
        state.telemetry.recordEmptyClaim();
        await sleep(sched().pollMs);
        continue;
      }
      state.telemetry.recordClaimed(claimedParts);

      const permitById = new Map(permits.map((p) => [p.permitId, p]));
      for (const part of claimedParts) {
        const permitId = part.submitPermitId;
        if (!permitId || !part.currentJobId) {
          if (permitId) {
            const orphan = permitById.get(permitId);
            if (orphan) await releasePermit(orphan);
          }
          await failSchedulerFile(part.fileId, 'Claimed OCR part without submit permit id or job id');
          continue;
        }
        const requestPermit = permitById.get(permitId);
        if (!requestPermit) {
          await failSchedulerFile(part.fileId, `Claimed OCR part ${part.partIndex} without matching request permit`);
          continue;
        }

        const { value: pagePermit, elapsedMs: pageMs } = await timed(() =>
          tryAcquireWeightedPermit({
            kind: 'ocr-submit-pages',
            permitId,
            capacity: rc.admittedPageBudget,
            weight: part.pageCount,
            ttlMs: sched().submitPermitLeaseTtlMs,
            owner: id,
            allowOversizeWhenEmpty: true,
            metadata: { fileId: part.fileId, partIndex: part.partIndex, pageCount: part.pageCount },
          }),
        );
        state.telemetry.recordTiming('pagePermitAcquireMs', pageMs);

        if (!pagePermit) {
          await releasePermit(requestPermit);
          await releaseClaimedDoclingPartForSubmitCapacity({
            fileId: part.fileId,
            partIndex: part.partIndex,
            jobId: part.currentJobId,
            errorMessage: 'OCR page admission budget is full',
            availableAt: new Date(Date.now() + sched().pollMs),
          });
          continue;
        }

        const currentDesired = getSubmitterDesiredConcurrency();
        const currentCapacity = getSubmitterLocalCapacity(currentDesired);
        if (state.activeProcessing + state.queue.size() >= currentCapacity) {
          await releasePermit(requestPermit);
          await releaseClaimedDoclingPartForSubmitCapacity({
            fileId: part.fileId,
            partIndex: part.partIndex,
            jobId: part.currentJobId,
            errorMessage: 'Submitter local queue capacity changed before OCR submit started',
            availableAt: new Date(Date.now() + sched().pollMs),
          });
          continue;
        }

        state.queue.push({ part, requestPermit, claimedAt: Date.now() });
      }
    } catch (error) {
      logger.error('[DOCLING_SCHEDULER][submitter] claimer error', {
        workerId: id, error: errMsg(error),
      });
      await sleep(sched().pollMs);
    }
  }
};

const runSubmitterProcessor = async (
  id: string,
  state: SubmitterSupervisorState,
  shouldStop: () => boolean,
) => {
  while (true) {
    if (shouldStop()) return;
    if (state.activeProcessing + state.reservedProcessing >= getSubmitterDesiredConcurrency()) {
      await sleep(sched().pollMs);
      continue;
    }
    state.reservedProcessing += 1;
    const queueStart = Date.now();
    const work = await state.queue.take(sched().pollMs);
    state.telemetry.recordTiming('queueWaitMs', Date.now() - queueStart);
    state.reservedProcessing = Math.max(state.reservedProcessing - 1, 0);

    if (!work) continue;

    if (state.activeProcessing >= getSubmitterDesiredConcurrency()) {
      state.queue.pushFront(work);
      await sleep(sched().pollMs);
      continue;
    }

    state.activeProcessing += 1;
    const startedAt = Date.now();
    const jobId = work.part.currentJobId;
    if (!jobId) {
      state.activeProcessing = Math.max(state.activeProcessing - 1, 0);
      await releaseQueuedSubmitWork(work, 'Queued claimed OCR part lost job id before processing');
      continue;
    }

    try {
      const file = await getDoclingFile(work.part.fileId);
      if (!file) throw new Error(`Missing scheduler file for ${work.part.fileId}`);

      const ctx = await getSchedulerFileContext(file);
      const { value: buffer, elapsedMs: readMs } = await timed(() => readBuffer(work.part.partPath));
      state.telemetry.recordTiming('readPartMs', readMs);

      const { elapsedMs: submitMs } = await timed(() =>
        submitDoclingAsyncJob({
          buffer,
          fileName: `${ctx.fileName}.part-${work.part.partIndex}.pdf`,
          jobId,
          fileId: work.part.fileId,
          docId: work.part.docId,
          vespaDocId: ctx.vespaDocId,
        }),
      );
      state.telemetry.recordTiming('submitMs', submitMs);

      const { elapsedMs: markMs } = await timed(() =>
        markDoclingPartSubmitted(work.part.fileId, work.part.partIndex, jobId),
      );
      state.telemetry.recordTiming('markSubmittedMs', markMs);

      logger.info('[DOCLING_SCHEDULER][submitter] part submitted', {
        fileId: work.part.fileId, partIndex: work.part.partIndex, jobId,
        readPartMs: readMs, submitMs, markSubmittedMs: markMs,
      });
    } catch (error) {
      await releasePermit(work.requestPermit);
      const message = errMsg(error);
      logger.error('[DOCLING_SCHEDULER][submitter] processor failed', {
        workerId: id, fileId: work.part.fileId, partIndex: work.part.partIndex, jobId, error: message,
      });
      if (work.part.attemptCount >= sched().maxPartAttempts) {
        await failSchedulerFile(
          work.part.fileId,
          `OCR submit failed for part ${work.part.partIndex} after ${work.part.attemptCount} attempts: ${message}`,
        );
      } else {
        await markDoclingPartSubmitRetry({
          fileId: work.part.fileId,
          partIndex: work.part.partIndex,
          jobId,
          errorMessage: message,
          availableAt: new Date(Date.now() + retryDelay(work.part.attemptCount)),
        });
      }
    } finally {
      state.telemetry.recordTiming('totalProcessMs', Date.now() - startedAt);
      state.activeProcessing = Math.max(state.activeProcessing - 1, 0);
    }
  }
};

export const startSubmitter = async () => {
  const supervisorId = workerId('submitter-supervisor');
  let stopRequested = false;
  const shouldStop = () => stopRequested;
  const state: SubmitterSupervisorState = {
    supervisorId,
    queue: new AsyncWorkQueue<ClaimedSubmitWork>(),
    telemetry: new SubmitterTelemetry(),
    activeProcessing: 0,
    reservedProcessing: 0,
  };

  const requestStop = () => { stopRequested = true; };
  process.once('SIGTERM', requestStop);
  process.once('SIGINT', requestStop);

  const capacityManager = (async () => {
    while (!shouldStop()) {
      try { await trimSubmitterQueueToCapacity(state); } catch { /* ignore */ }
      await sleep(sched().pollMs);
    }
  })();

  const numClaimers = sched().maxConcurrentClaimers ?? 1;
  const claimers = Array.from({ length: numClaimers }, (_, i) =>
    runSubmitterClaimer(workerId(`submitter-claimer-${i}`), state, shouldStop),
  );

  try {
    await Promise.all([
      runSubmitterAdmissionCoordinator(state, shouldStop),
      capacityManager,
      startDynamicRolePool({
        role: 'submitter-processor',
        getDesiredConcurrency: getSubmitterDesiredConcurrency,
        runWorker: (name, workerShouldStop) => runSubmitterProcessor(name, state, workerShouldStop),
      }),
      ...claimers,
    ]);
  } finally {
    process.off('SIGTERM', requestStop);
    process.off('SIGINT', requestStop);

    logger.info('[DOCLING_SCHEDULER][submitter] shutdown drain started', {
      workerId: supervisorId,
      activeProcessing: state.activeProcessing,
      queuedWork: state.queue.size(),
    });

    let released = 0;
    while (state.queue.size() > 0) {
      const work = state.queue.popNewest();
      if (!work) break;
      await releaseQueuedSubmitWork(work, 'Submitter supervisor stopped before queued OCR submit started');
      released += 1;
    }

    const drainDeadlineMs = sched().submitterShutdownDrainMs ?? 30_000;
    const drainDeadline = Date.now() + drainDeadlineMs;
    while (state.activeProcessing > 0 && Date.now() < drainDeadline) {
      await sleep(100);
    }

    if (state.activeProcessing > 0) {
      logger.warn('[DOCLING_SCHEDULER][submitter] drain timed out with active work', {
        workerId: supervisorId, activeProcessing: state.activeProcessing, released, drainDeadlineMs,
      });
    } else {
      logger.info('[DOCLING_SCHEDULER][submitter] drain completed', {
        workerId: supervisorId, released,
      });
    }
  }
};


// ── Writer ───────────────────────────────────────────────────────────────────

const runWriterWorker = async (id: string, shouldStop: () => boolean) => {
  for (;;) {
    if (shouldStop()) return;
    const file = await claimNextDoclingFileToWrite(id, sched().leaseMs);
    if (!file) {
      await sleep(sched().pollMs);
      continue;
    }

    logger.info('[DOCLING_SCHEDULER][writer] claimed file → writing', {
      fileId: file.fileId,
      totalParts: file.totalParts,
    });
    let permit: Awaited<ReturnType<typeof tryAcquirePermit>> | null = null;
    try {
      const parts = await getDoclingPartsForFile(file.fileId);
      if (parts.length !== file.totalParts) {
        throw new Error(`Expected ${file.totalParts} parts, found ${parts.length}`);
      }

      // Total OCR time for the whole file: file admitted into active OCR
      // (file.ocrActivatedAt) → the last part's OCR result arriving (max readyAt).
      const ocrStart = file.ocrActivatedAt?.getTime() ?? null;
      const readyTimes = parts.map((p) => p.readyAt?.getTime() ?? null);
      const ocrEnd = readyTimes.every((t) => t !== null)
        ? Math.max(...(readyTimes as number[]))
        : null;
      const totalOcrMs = ocrStart !== null && ocrEnd !== null ? ocrEnd - ocrStart : null;
      logger.info('[DOCLING_SCHEDULER_METRICS][writer] total OCR time for file', {
        fileId: file.fileId,
        totalParts: file.totalParts,
        totalOcrMs,
        perPartOcrMs: parts.map((p) => ({
          partIndex: p.partIndex,
          ocrMs: p.submittedAt && p.readyAt ? p.readyAt.getTime() - p.submittedAt.getTime() : null,
        })),
      });

      const aggregate = await aggregatePartResults(parts);
      logger.info('[DOCLING_SCHEDULER][writer] aggregated parts', {
        fileId: file.fileId,
        chunks: aggregate.chunks.length,
        imageChunks: aggregate.image_chunks.length,
      });

      // Reuse the existing mappers (permissions/owner/urls); inject OCR chunks.
      // Lazy import to avoid a circular-dependency at module load (see top of file).
      const override = {
        chunks: aggregate.chunks,
        chunks_pos: aggregate.chunks_pos,
        chunks_map: aggregate.chunks_map,
        image_chunks: aggregate.image_chunks,
        image_chunks_pos: aggregate.image_chunks_pos,
        documentOutline: aggregate.toc_chunks.join('\n') || undefined,
      };
      const isAttachment = file.collectionId === '';
      const { mapCollection, mapFile } = await import('@/zero/vespa-injection/core/mapper');

      let vespaDoc;
      let vespaDocId: string;
      let fileName: string;
      if (isAttachment) {
        const att = await db.messageAttachment.findUnique({ where: { id: file.fileId } });
        if (!att) {
          throw new TerminalDoclingSchedulerError(`No message attachment for id=${file.fileId}`);
        }
        vespaDocId = att.id;
        fileName = att.originalFilename || att.id;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vespaDoc = await mapFile(att as any, undefined, undefined, override);
      } else {
        const item = await db.collectionItem.findFirst({
          where: { fileId: file.fileId, isLatest: true },
        });
        if (!item) {
          throw new TerminalDoclingSchedulerError(`No collection item for fileId=${file.fileId}`);
        }
        vespaDocId = item.fileId;
        fileName = item.name;
        vespaDoc = await mapCollection(item, override);
      }

      const payloadBytes = Buffer.byteLength(JSON.stringify(vespaDoc), 'utf8');
      if (payloadBytes > sched().maxVespaPayloadBytes) {
        await failDoclingFileIfOwned(
          file,
          DOCLING_FILE_STATUS.Writing,
          `Vespa payload ${payloadBytes} bytes exceeds limit ${sched().maxVespaPayloadBytes}`,
        );
        continue;
      }

      while (!permit) {
        permit = await tryAcquirePermit({
          kind: 'vespa-write',
          capacity: getRuntimeConfig().vespaWritePermits,
          ttlMs: sched().vespaWritePermitTtlMs,
          owner: id,
          metadata: { fileId: file.fileId },
        });
        if (!permit) await sleep(sched().pollMs);
      }

      const [result] = await vespaClient.crudService.insert(
        [vespaDoc as InsertDocument],
        fileSchema,
      );
      if (!result.success) {
        throw new Error(`Vespa insert failed: ${result.error}`);
      }
      logger.info('[DOCLING_SCHEDULER][writer] wrote document to Vespa', {
        fileId: file.fileId,
        docId: vespaDocId,
        chunks: aggregate.chunks.length,
      });
      await releasePermit(permit);
      permit = null;

      const completed = await markDoclingFileCompleted({
        fileId: file.fileId,
        statusMessage: `OCR complete: ${aggregate.chunks.length + aggregate.image_chunks.length} chunks from ${fileName}`,
        leaseOwner: file.leaseOwner,
        leaseToken: file.leaseToken,
      });
      if (!completed) {
        logger.warn('[DOCLING_SCHEDULER] Ignoring stale write completion (lease changed)', {
          fileId: file.fileId,
        });
        continue;
      }

      logger.info('[DOCLING_SCHEDULER][writer] ✅ file COMPLETED', {
        fileId: file.fileId,
        fileName,
        docId: vespaDocId,
        chunks: aggregate.chunks.length,
      });

      if (!sched().keepTempResults) {
        await cleanupStage(file.fileId);
      }
    } catch (error) {
      if (permit) await releasePermit(permit);
      const message = errMsg(error);
      if (isTerminalDoclingSchedulerError(error) || !isRetryableVespaError(error) || file.writeAttemptCount >= sched().maxWriteAttempts) {
        await failDoclingFileIfOwned(
          file,
          DOCLING_FILE_STATUS.Writing,
          `Vespa write failed for ${file.fileId} after ${file.writeAttemptCount} attempts: ${message}`,
        );
      } else {
        await markDoclingFileWriteRetry(
          file,
          message,
          new Date(Date.now() + retryDelay(file.writeAttemptCount)),
        );
      }
    }
  }
};

export const startWriter = () =>
  startDynamicRolePool({
    role: 'writer',
    getDesiredConcurrency: () => getRuntimeConfig().vespaWritePermits,
    runWorker: runWriterWorker,
  });

// ── Reconciliation ───────────────────────────────────────────────────────────

const reconcileOcrSubmitPermits = async (): Promise<number> => {
  const permitReconcileBatch = sched().permitReconcileBatch ?? 200;
  const submitPermitIds = await listActivePermitIds('ocr-submit', permitReconcileBatch);
  const pagePermitIds = await listActivePermitIds('ocr-submit-pages', permitReconcileBatch);
  const allIds = Array.from(new Set([...submitPermitIds, ...pagePermitIds]));
  if (allIds.length === 0) return 0;

  const liveIds = await listLiveDoclingSubmitPermitIds(allIds);
  const orphans = allIds.filter((id) => !liveIds.has(id));
  for (const id of orphans) {
    await releasePermit({ kind: 'ocr-submit', permitId: id });
  }
  if (orphans.length > 0) {
    logger.warn('[DOCLING_SCHEDULER][reaper] released orphaned OCR submit permits', {
      released: orphans.length,
    });
  }
  return orphans.length;
};

const isSchedulerDoclingJobId = (jobId: string) =>
  /^docling:[^:]+:part:\d+:attempt:[^:]+$/.test(jobId);

const reconcileWrapperGlobalActiveKeys = async (): Promise<number> => {
  if (!wrapperGlobalActiveKey) return 0;
  const { redisService } = await import('@/services/redisService');
  const client = redisService.getClient();
  const now = Date.now();
  await client.zremrangebyscore(wrapperGlobalActiveKey, '-inf', String(now));
  const permitReconcileBatch = sched().permitReconcileBatch ?? 200;
  const jobIds = await client.zrange(wrapperGlobalActiveKey, 0, permitReconcileBatch - 1);
  if (jobIds.length === 0) return 0;

  const schedulerJobIds = jobIds.filter(isSchedulerDoclingJobId);
  if (schedulerJobIds.length === 0) return 0;

  const liveJobIds = await listLiveDoclingCurrentJobIds(schedulerJobIds);
  const staleJobIds = schedulerJobIds.filter((id) => !liveJobIds.has(id));
  if (staleJobIds.length === 0) return 0;

  await client.zrem(wrapperGlobalActiveKey, ...staleJobIds);
  logger.warn('[DOCLING_SCHEDULER][reaper] removed stale wrapper global active entries', {
    key: wrapperGlobalActiveKey, removed: staleJobIds.length,
  });
  return staleJobIds.length;
};

// ── Reaper ───────────────────────────────────────────────────────────────────

export const startReaper = async () => {
  for (;;) {
    try {
      const deletedFileIds = await listDeletedActiveDoclingFileIds(50);
      for (const fileId of deletedFileIds) {
        await failSchedulerFile(
          fileId,
          'Collection item was deleted before Docling scheduler completion',
        );
      }
      if (deletedFileIds.length > 0) {
        logger.warn('[DOCLING_SCHEDULER][reaper] failed files whose collection items were deleted', {
          count: deletedFileIds.length,
        });
      }

      for (const part of await listExpiredSubmittingDoclingParts(50)) {
        if (part.submitPermitId) await releasePermit({ kind: 'ocr-submit', permitId: part.submitPermitId });
      }
      await requeueExpiredDoclingLeases();

      const timedOut = await listTimedOutSubmittedDoclingParts(submittedPartTimeoutMs(), 50);
      for (const part of timedOut) {
        if (part.submitPermitId) await releasePermit({ kind: 'ocr-submit', permitId: part.submitPermitId });
        if (part.currentJobId && part.attemptCount >= sched().maxPartAttempts) {
          await failSchedulerFile(
            part.fileId,
            `OCR timed out for part ${part.partIndex} after ${part.attemptCount} attempts`,
          );
        } else if (part.currentJobId) {
          await markDoclingPartSubmitRetry({
            fileId: part.fileId,
            partIndex: part.partIndex,
            jobId: part.currentJobId,
            errorMessage: `OCR timed out after ${submittedPartTimeoutMs()}ms`,
            availableAt: new Date(Date.now() + retryDelay(part.attemptCount)),
          });
        }
      }

      await reconcileOcrSubmitPermits();
      await reconcileWrapperGlobalActiveKeys();
    } catch (error) {
      logger.error('[DOCLING_SCHEDULER] reaper failed', { error: errMsg(error) });
    }
    await sleep(sched().pollMs);
  }
};

// ── Role dispatcher ──────────────────────────────────────────────────────────

export const startDoclingSchedulerRole = async (role: string): Promise<void> => {
  if (!sched().enabled) {
    throw new Error('DOCLING_ASYNC_SCHEDULER_ENABLED must be true to start scheduler roles');
  }
  switch (role) {
    case 'splitter':
      return startSplitter();
    case 'submitter':
      return startSubmitter();
    case 'result': {
      const { startResultWorker } = await import('./result');
      return startResultWorker();
    }
    case 'writer':
      return startWriter();
    case 'reaper':
      return startReaper();
    case 'all':
      // Single-pod mode: run every role concurrently.
      void startSplitter();
      void startSubmitter();
      void import('./result').then(({ startResultWorker }) => startResultWorker());
      void startWriter();
      void startReaper();
      return;
    default:
      throw new Error(
        `Unknown DOCLING_SCHEDULER_ROLE=${role}. Expected splitter|submitter|result|writer|reaper|all.`,
      );
  }
};
