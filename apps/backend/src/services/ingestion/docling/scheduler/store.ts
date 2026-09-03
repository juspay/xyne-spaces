/**
 * DB state-machine store for the async OCR scheduler.
 *
 * Ported from xyne-search `lib/doclingSchedulerStore.ts` (Drizzle) → Prisma.
 * The claim/lease/admission queries are written as raw SQL via `$queryRaw`/
 * `$executeRaw` because Prisma's query builder cannot express
 * `FOR UPDATE SKIP LOCKED`, `pg_try_advisory_xact_lock`, or the CTEs these rely
 * on. Get these wrong and multiple worker pods double-process the same row.
 * Simple status updates and bulk inserts use the typed Prisma client.
 *
 * Adaptation from xyne-search: collection_items updates key by `fileId` +
 * `isLatest` and set `ingestionStatus` (xyne-spaces lacks uploadStatus/etc.).
 */
import { randomUUID } from 'node:crypto';
import { resolveWorkspaceIdFromModel } from '@/database/tenant/workspace-utils';
import { db } from '@/database/client';
import { config } from '@/config/env';
import { currentWorkspaceId } from '@/database/tenant/context';
import { Prisma } from '@prisma/client';
import { IngestionStatus } from '@xyne/shared';
import { maybeNotifyCollectionIngestionComplete } from '@/services/collectionIngestionNotifier';
import {
  DOCLING_FILE_STATUS,
  DOCLING_PART_STATUS,
  type DoclingFile,
  type DoclingPart,
  type DoclingStagedParts,
  type QueueFileForSplitInput,
} from '../types';

type RawRow = Record<string, unknown>;

const dateOrNull = (value: unknown): Date | null =>
  value instanceof Date ? value : value ? new Date(String(value)) : null;

const numberValue = (value: unknown, fallback = 0): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const fileFromRow = (row: RawRow): DoclingFile => ({
  fileId: String(row.file_id),
  workspaceId: row.workspace_id ? String(row.workspace_id) : null,
  collectionId: String(row.collection_id),
  sourcePath: String(row.source_path),
  sourceStorageKey: row.source_storage_key ? String(row.source_storage_key) : null,
  stageDir: row.stage_dir ? String(row.stage_dir) : null,
  resultsDir: row.results_dir ? String(row.results_dir) : null,
  basePriority: numberValue(row.base_priority),
  priorityOverride:
    row.priority_override === null || row.priority_override === undefined
      ? null
      : numberValue(row.priority_override),
  status: String(row.status),
  totalPages: numberValue(row.total_pages),
  totalParts: numberValue(row.total_parts),
  pageChunkSize: numberValue(row.page_chunk_size),
  readyPartsCount: numberValue(row.ready_parts_count),
  writeAttemptCount: numberValue(row.write_attempt_count),
  splitAttemptCount: numberValue(row.split_attempt_count),
  availableAt: dateOrNull(row.available_at) || new Date(),
  leaseOwner: row.lease_owner ? String(row.lease_owner) : null,
  leaseToken: row.lease_token ? String(row.lease_token) : null,
  leaseUntil: dateOrNull(row.lease_until),
  ocrActivatedAt: dateOrNull(row.ocr_activated_at),
  completedAt: dateOrNull(row.completed_at),
  errorMessage: row.error_message ? String(row.error_message) : null,
  createdAt: dateOrNull(row.created_at) || new Date(),
  updatedAt: dateOrNull(row.updated_at) || new Date(),
});

const partFromRow = (row: RawRow): DoclingPart => ({
  fileId: String(row.file_id),
  partIndex: numberValue(row.part_index),
  docId: String(row.doc_id),
  currentJobId: row.current_job_id ? String(row.current_job_id) : null,
  partPath: String(row.part_path),
  resultPath: row.result_path ? String(row.result_path) : null,
  startPage: numberValue(row.start_page),
  endPage: numberValue(row.end_page),
  pageCount: numberValue(row.page_count, Math.max(numberValue(row.end_page) - numberValue(row.start_page), 0)),
  partSizeBytes: numberValue(row.part_size_bytes),
  status: String(row.status),
  attemptCount: numberValue(row.attempt_count),
  availableAt: dateOrNull(row.available_at) || new Date(),
  submittedAt: dateOrNull(row.submitted_at),
  readyAt: dateOrNull(row.ready_at),
  writtenAt: dateOrNull(row.written_at),
  leaseOwner: row.lease_owner ? String(row.lease_owner) : null,
  leaseUntil: dateOrNull(row.lease_until),
  submitPermitId: row.submit_permit_id ? String(row.submit_permit_id) : null,
  errorMessage: row.error_message ? String(row.error_message) : null,
  createdAt: dateOrNull(row.created_at) || new Date(),
  updatedAt: dateOrNull(row.updated_at) || new Date(),
});

/** Mark the latest collection item for a file with an ingestion status. */
const setCollectionItemStatus = async (
  tx: Prisma.TransactionClient,
  fileId: string,
  status: IngestionStatus,
): Promise<void> => {
  await tx.collectionItem.updateMany({
    where: { fileId, isLatest: true },
    data: { ingestionStatus: status },
  });
};

export const inferDoclingSourcePriority = (input: { collectionId: string }) => {
  // '' sentinel = chat/ticket attachment; a real collectionId = KB collection file.
  // KB files get the highest OCR priority (claimed ORDER BY base_priority DESC).
  const isKb = input.collectionId !== '';
  const basePriority = isKb
    ? config.kbIngestion.ocrPriority // KB collections: highest (default 200)
    : config.kbIngestion.attachmentOcrPriority; // attachments (default 100)
  return { basePriority };
};

/** Insert a file at pending_split. Returns null if it already exists (no-op). */
export const upsertDoclingAsyncFileForSplit = async (
  input: QueueFileForSplitInput,
): Promise<DoclingFile | null> => {
  const basePriority = input.basePriority ?? 0;
  const ws = currentWorkspaceId();
  if (!ws) {
    throw new Error('workspaceId required: no tenant context');
  }
  try {
    const row = await db.doclingAsyncFile.create({
      data: {
        fileId: input.fileId,
        workspaceId: ws,
        collectionId: input.collectionId,
        sourcePath: input.sourcePath,
        sourceStorageKey: input.sourceStorageKey ?? null,
        basePriority,
        priorityOverride: input.priorityOverride ?? null,
        totalPages: input.totalPages ?? 0,
        totalParts: input.totalParts ?? 0,
        pageChunkSize: input.pageChunkSize ?? 0,
        status: DOCLING_FILE_STATUS.PendingSplit,
        availableAt: new Date(),
      },
    });
    return row as unknown as DoclingFile;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return null; // already queued
    }
    throw err;
  }
};

export const claimNextDoclingFileToSplit = async (
  workerId: string,
  leaseMs: number,
): Promise<DoclingFile | null> => {
  const leaseToken = randomUUID();
  const rows = await db.$queryRaw<RawRow[]>`
    UPDATE non_zero.docling_async_files
    SET status = ${DOCLING_FILE_STATUS.Splitting},
        lease_owner = ${workerId},
        lease_token = ${leaseToken},
        lease_until = NOW() + (${leaseMs}::int * interval '1 millisecond'),
        updated_at = NOW(),
        error_message = NULL
    WHERE file_id = (
      SELECT file_id
      FROM non_zero.docling_async_files
      WHERE status = ${DOCLING_FILE_STATUS.PendingSplit}
        AND available_at <= NOW()
      ORDER BY COALESCE(priority_override, base_priority) DESC, created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING *`;
  return rows[0] ? fileFromRow(rows[0]) : null;
};

export const markDoclingFileSplitComplete = async (
  file: DoclingFile,
  stagedParts: DoclingStagedParts,
  resultsDir: string,
): Promise<boolean> => {
  return await db.$transaction(async (tx) => {
    const claimed = await tx.$queryRaw<RawRow[]>`
      UPDATE non_zero.docling_async_files
      SET status = ${DOCLING_FILE_STATUS.QueuedForOcr},
          total_pages = ${stagedParts.totalPages},
          total_parts = ${stagedParts.partsTotal},
          page_chunk_size = ${stagedParts.pageChunkSize},
          stage_dir = ${stagedParts.stageDir},
          results_dir = ${resultsDir},
          ready_parts_count = 0,
          lease_owner = NULL,
          lease_token = NULL,
          lease_until = NULL,
          available_at = NOW(),
          updated_at = NOW()
      WHERE file_id = ${file.fileId}
        AND status = ${DOCLING_FILE_STATUS.Splitting}
        AND lease_owner = ${file.leaseOwner}
        AND lease_token = ${file.leaseToken}
        AND lease_until IS NOT NULL AND lease_until >= NOW()
      RETURNING file_id`;

    if (claimed.length === 0) {
      return false;
    }

    const workspaceId = await resolveWorkspaceIdFromModel(tx, 'doclingAsyncFile', { fileId: file.fileId });

    await tx.doclingAsyncPart.deleteMany({ where: { fileId: file.fileId } });
    await tx.doclingAsyncPart.createMany({
      data: stagedParts.parts.map((part) => ({
        fileId: file.fileId,
        workspaceId,
        partIndex: part.partIndex,
        docId: part.partDocId,
        partPath: part.partPath,
        startPage: part.startPage,
        endPage: part.endPage,
        pageCount: Math.max(part.endPage - part.startPage, 0),
        partSizeBytes: part.partSizeBytes,
        status: DOCLING_PART_STATUS.Queued,
        availableAt: new Date(),
      })),
    });
    return true;
  });
};

export const markDoclingFileSplitRetry = async (
  file: DoclingFile,
  errorMessage: string,
  availableAt: Date,
): Promise<boolean> => {
  const rows = await db.$queryRaw<RawRow[]>`
    UPDATE non_zero.docling_async_files
    SET status = ${DOCLING_FILE_STATUS.PendingSplit},
        available_at = ${availableAt},
        split_attempt_count = split_attempt_count + 1,
        lease_owner = NULL,
        lease_token = NULL,
        lease_until = NULL,
        error_message = ${errorMessage},
        updated_at = NOW()
    WHERE file_id = ${file.fileId}
      AND status = ${DOCLING_FILE_STATUS.Splitting}
      AND lease_owner = ${file.leaseOwner}
      AND lease_token = ${file.leaseToken}
      AND lease_until IS NOT NULL AND lease_until >= NOW()
    RETURNING file_id`;
  return rows.length > 0;
};

export const admitDoclingOcrFiles = async (input: {
  activeFileLimit: number;
  admittedPageBudget: number;
}): Promise<number> => {
  if (input.activeFileLimit <= 0 || input.admittedPageBudget <= 0) {
    return 0;
  }
  const rows = await db.$queryRaw<RawRow[]>`
    WITH admit_lock AS (
      SELECT pg_try_advisory_xact_lock(hashtext('docling_ocr_file_admit')) AS locked
    ),
    active_state AS (
      SELECT
        COUNT(DISTINCT f.file_id)::int AS active_files,
        COALESCE(SUM(
          CASE
            WHEN p.status IN (${DOCLING_PART_STATUS.Queued}, ${DOCLING_PART_STATUS.Submitting}, ${DOCLING_PART_STATUS.Submitted})
            THEN COALESCE(p.page_count, GREATEST(p.end_page - p.start_page, 0))
            ELSE 0
          END
        ), 0)::int AS admitted_pages
      FROM non_zero.docling_async_files f
      LEFT JOIN non_zero.docling_async_parts p ON p.file_id = f.file_id
      WHERE f.status = ${DOCLING_FILE_STATUS.OcrActive}
    ),
    capacity AS (
      SELECT
        GREATEST(${input.activeFileLimit}::int - active_files, 0)::int AS slots,
        GREATEST(${input.admittedPageBudget}::int - admitted_pages, 0)::int AS pages,
        active_files,
        admitted_pages
      FROM active_state
    ),
    available_files AS (
      SELECT
        f.file_id,
        f.total_pages,
        COALESCE(f.priority_override, f.base_priority) AS file_priority,
        f.created_at
      FROM non_zero.docling_async_files f
      CROSS JOIN capacity c
      CROSS JOIN admit_lock l
      LEFT JOIN collection_items ci ON ci."fileId" = f.file_id AND ci."isLatest" = true
      WHERE f.status = ${DOCLING_FILE_STATUS.QueuedForOcr}
        AND f.available_at <= NOW()
        AND l.locked
        AND c.slots > 0
        AND (ci."fileId" IS NULL OR ci."deletedAt" IS NULL)
      ORDER BY COALESCE(f.priority_override, f.base_priority) DESC, f.created_at ASC
      FOR UPDATE OF f SKIP LOCKED
    ),
    ranked_files AS (
      SELECT
        file_id,
        total_pages,
        file_priority,
        created_at,
        ROW_NUMBER() OVER (ORDER BY file_priority DESC, created_at ASC, file_id ASC) AS queued_rank
      FROM available_files
    ),
    eligible_files AS (
      SELECT r.*
      FROM ranked_files r, capacity cap
      WHERE GREATEST(r.total_pages, 0) <= cap.pages
        OR (cap.active_files = 0 AND cap.admitted_pages = 0 AND r.queued_rank = 1)
    ),
    candidates AS (
      SELECT
        file_id,
        total_pages,
        queued_rank AS rn,
        SUM(GREATEST(total_pages, 0)) OVER (
          ORDER BY file_priority DESC, created_at ASC, file_id ASC
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS cumulative_pages
      FROM eligible_files
    ),
    selected AS (
      SELECT c.file_id
      FROM candidates c, capacity cap
      WHERE c.cumulative_pages <= cap.pages
        OR (cap.active_files = 0 AND cap.admitted_pages = 0 AND c.rn = 1)
      ORDER BY c.rn
      LIMIT (SELECT slots FROM capacity)
    )
    UPDATE non_zero.docling_async_files f
    SET status = ${DOCLING_FILE_STATUS.OcrActive},
        ocr_activated_at = COALESCE(f.ocr_activated_at, NOW()),
        updated_at = NOW()
    FROM selected
    WHERE f.file_id = selected.file_id
    RETURNING f.file_id`;
  return rows.length;
};

export type DoclingOcrPageCounters = {
  pendingOcrPages: number;
  activeOcrPages: number;
  activeOcrChunks: number;
  admittedOcrPages: number;
  completedOcrPagesPerMinute: number;
};
export const markDoclingPartSubmitted = async (
  fileId: string,
  partIndex: number,
  jobId: string,
): Promise<void> => {
  await db.$executeRaw`
    UPDATE non_zero.docling_async_parts
    SET status = ${DOCLING_PART_STATUS.Submitted},
        submitted_at = NOW(),
        lease_owner = NULL,
        lease_until = NULL,
        updated_at = NOW()
    WHERE file_id = ${fileId}
      AND part_index = ${partIndex}
      AND current_job_id = ${jobId}
      AND status = ${DOCLING_PART_STATUS.Submitting}`;
};

export const markDoclingPartSubmitRetry = async (input: {
  fileId: string;
  partIndex: number;
  jobId: string;
  errorMessage: string;
  availableAt: Date;
}): Promise<void> => {
  await db.$executeRaw`
    WITH reset AS (
      UPDATE non_zero.docling_async_parts
      SET status = ${DOCLING_PART_STATUS.Queued},
          available_at = ${input.availableAt},
          lease_owner = NULL,
          lease_until = NULL,
          submit_permit_id = NULL,
          error_message = ${input.errorMessage},
          updated_at = NOW()
      WHERE file_id = ${input.fileId}
        AND part_index = ${input.partIndex}
        AND current_job_id = ${input.jobId}
        AND status IN (${DOCLING_PART_STATUS.Submitting}, ${DOCLING_PART_STATUS.Submitted})
      RETURNING file_id
    )
    UPDATE non_zero.docling_async_files f
    SET updated_at = NOW()
    FROM reset
    WHERE f.file_id = reset.file_id`;
};

export const getDoclingPartByJobId = async (
  jobId: string,
): Promise<DoclingPart | null> => {
  const rows = await db.$queryRaw<RawRow[]>`
    SELECT * FROM non_zero.docling_async_parts WHERE current_job_id = ${jobId} LIMIT 1`;
  return rows[0] ? partFromRow(rows[0]) : null;
};

export const getDoclingFile = async (fileId: string): Promise<DoclingFile | null> => {
  const rows = await db.$queryRaw<RawRow[]>`
    SELECT * FROM non_zero.docling_async_files WHERE file_id = ${fileId} LIMIT 1`;
  return rows[0] ? fileFromRow(rows[0]) : null;
};

export const getDoclingPartsForFile = async (
  fileId: string,
): Promise<DoclingPart[]> => {
  const rows = await db.$queryRaw<RawRow[]>`
    SELECT * FROM non_zero.docling_async_parts WHERE file_id = ${fileId} ORDER BY part_index ASC`;
  return rows.map(partFromRow);
};

export const markDoclingPartReady = async (input: {
  fileId: string;
  partIndex: number;
  jobId: string;
  resultPath: string;
}): Promise<void> => {
  await db.$transaction(async (tx) => {
    const ready = await tx.$queryRaw<RawRow[]>`
      UPDATE non_zero.docling_async_parts
      SET status = ${DOCLING_PART_STATUS.Ready},
          result_path = ${input.resultPath},
          ready_at = NOW(),
          lease_owner = NULL,
          lease_until = NULL,
          updated_at = NOW()
      WHERE file_id = ${input.fileId}
        AND part_index = ${input.partIndex}
        AND current_job_id = ${input.jobId}
        AND status IN (${DOCLING_PART_STATUS.Submitting}, ${DOCLING_PART_STATUS.Submitted})
      RETURNING file_id`;

    if (ready.length === 0) {
      return;
    }

    await tx.$executeRaw`
      UPDATE non_zero.docling_async_files
      SET ready_parts_count = ready_parts_count + 1,
          updated_at = NOW()
      WHERE file_id = ${input.fileId}`;

    await tx.$executeRaw`
      UPDATE non_zero.docling_async_files
      SET status = ${DOCLING_FILE_STATUS.ReadyToWrite},
          available_at = NOW(),
          updated_at = NOW()
      WHERE file_id = ${input.fileId}
        AND status = ${DOCLING_FILE_STATUS.OcrActive}
        AND ready_parts_count >= total_parts`;
  });
};

export const failDoclingFile = async (
  fileId: string,
  errorMessage: string,
): Promise<void> => {
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE non_zero.docling_async_files
      SET status = ${DOCLING_FILE_STATUS.Failed},
          lease_owner = NULL, lease_token = NULL, lease_until = NULL,
          error_message = ${errorMessage}, updated_at = NOW()
      WHERE file_id = ${fileId}`;
    await tx.$executeRaw`
      UPDATE non_zero.docling_async_parts
      SET status = ${DOCLING_PART_STATUS.Failed},
          error_message = ${errorMessage},
          lease_owner = NULL, lease_until = NULL, updated_at = NOW()
      WHERE file_id = ${fileId}`;
    await setCollectionItemStatus(tx, fileId, IngestionStatus.FAILED);
  });
  // Terminal transition committed — check if the whole collection is now done.
  void maybeNotifyCollectionIngestionComplete(fileId).catch(() => {});
};

export const failDoclingFileIfOwned = async (
  file: DoclingFile,
  expectedStatus: string,
  errorMessage: string,
): Promise<boolean> => {
  const owned = await db.$transaction(async (tx) => {
    const claimed = await tx.$queryRaw<RawRow[]>`
      UPDATE non_zero.docling_async_files
      SET status = ${DOCLING_FILE_STATUS.Failed},
          lease_owner = NULL, lease_token = NULL, lease_until = NULL,
          error_message = ${errorMessage}, updated_at = NOW()
      WHERE file_id = ${file.fileId}
        AND status = ${expectedStatus}
        AND lease_owner = ${file.leaseOwner}
        AND lease_token = ${file.leaseToken}
        AND lease_until IS NOT NULL AND lease_until >= NOW()
      RETURNING file_id`;

    if (claimed.length === 0) {
      return false;
    }

    await tx.$executeRaw`
      UPDATE non_zero.docling_async_parts
      SET status = ${DOCLING_PART_STATUS.Failed},
          error_message = ${errorMessage},
          lease_owner = NULL, lease_until = NULL, updated_at = NOW()
      WHERE file_id = ${file.fileId}`;
    await setCollectionItemStatus(tx, file.fileId, IngestionStatus.FAILED);
    return true;
  });
  if (owned) {
    void maybeNotifyCollectionIngestionComplete(file.fileId).catch(() => {});
  }
  return owned;
};

export const claimNextDoclingFileToWrite = async (
  workerId: string,
  leaseMs: number,
): Promise<DoclingFile | null> => {
  const leaseToken = randomUUID();
  const rows = await db.$queryRaw<RawRow[]>`
    UPDATE non_zero.docling_async_files
    SET status = ${DOCLING_FILE_STATUS.Writing},
        lease_owner = ${workerId},
        lease_token = ${leaseToken},
        lease_until = NOW() + (${leaseMs}::int * interval '1 millisecond'),
        write_attempt_count = write_attempt_count + 1,
        updated_at = NOW()
    WHERE file_id = (
      SELECT file_id
      FROM non_zero.docling_async_files
      WHERE status = ${DOCLING_FILE_STATUS.ReadyToWrite}
        AND available_at <= NOW()
      ORDER BY COALESCE(priority_override, base_priority) DESC, created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING *`;
  return rows[0] ? fileFromRow(rows[0]) : null;
};

export const markDoclingFileWriteRetry = async (
  file: DoclingFile,
  errorMessage: string,
  availableAt: Date,
): Promise<boolean> => {
  const rows = await db.$queryRaw<RawRow[]>`
    UPDATE non_zero.docling_async_files
    SET status = ${DOCLING_FILE_STATUS.ReadyToWrite},
        available_at = ${availableAt},
        lease_owner = NULL, lease_token = NULL, lease_until = NULL,
        error_message = ${errorMessage}, updated_at = NOW()
    WHERE file_id = ${file.fileId}
      AND status = ${DOCLING_FILE_STATUS.Writing}
      AND lease_owner = ${file.leaseOwner}
      AND lease_token = ${file.leaseToken}
      AND lease_until IS NOT NULL AND lease_until >= NOW()
    RETURNING file_id`;
  return rows.length > 0;
};

export const markDoclingFileCompleted = async (input: {
  fileId: string;
  statusMessage: string;
  leaseOwner?: string | null;
  leaseToken?: string | null;
}): Promise<boolean> => {
  const completed = await db.$transaction(async (tx) => {
    const claimed = await tx.$queryRaw<RawRow[]>`
      UPDATE non_zero.docling_async_files
      SET status = ${DOCLING_FILE_STATUS.Completed},
          completed_at = NOW(),
          lease_owner = NULL, lease_token = NULL, lease_until = NULL,
          error_message = NULL, updated_at = NOW()
      WHERE file_id = ${input.fileId}
        AND status = ${DOCLING_FILE_STATUS.Writing}
        AND lease_owner = ${input.leaseOwner}
        AND lease_token = ${input.leaseToken}
        AND lease_until IS NOT NULL AND lease_until >= NOW()
      RETURNING file_id`;

    if (claimed.length === 0) {
      return false;
    }

    await setCollectionItemStatus(tx, input.fileId, IngestionStatus.COMPLETED);
    await tx.$executeRaw`
      UPDATE non_zero.docling_async_parts
      SET status = ${DOCLING_PART_STATUS.Written}, written_at = NOW(), updated_at = NOW()
      WHERE file_id = ${input.fileId}`;
    return true;
  });
  if (completed) {
    void maybeNotifyCollectionIngestionComplete(input.fileId).catch(() => {});
  }
  return completed;
};

/**
 * Mark a file COMPLETED after the synchronous fallback ladder ingested it
 * (the async OCR path was exhausted). Unlike markDoclingFileCompleted this does
 * NOT require a held write-lease — at fail time the file is already lease-free.
 * `statusMessage` is recorded in error_message for observability (e.g. which
 * engine recovered it).
 */
export const completeDoclingFileViaSyncFallback = async (
  fileId: string,
  statusMessage: string,
): Promise<void> => {
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE non_zero.docling_async_files
      SET status = ${DOCLING_FILE_STATUS.Completed},
          completed_at = NOW(),
          lease_owner = NULL, lease_token = NULL, lease_until = NULL,
          error_message = ${statusMessage}, updated_at = NOW()
      WHERE file_id = ${fileId}`;
    await tx.$executeRaw`
      UPDATE non_zero.docling_async_parts
      SET status = ${DOCLING_PART_STATUS.Written}, written_at = NOW(), updated_at = NOW()
      WHERE file_id = ${fileId}`;
    await setCollectionItemStatus(tx, fileId, IngestionStatus.COMPLETED);
  });
  // Terminal transition committed — check if the whole collection is now done.
  void maybeNotifyCollectionIngestionComplete(fileId).catch(() => {});
};

export const requeueExpiredDoclingLeases = async (now = new Date()): Promise<void> => {
  await db.$executeRaw`
    UPDATE non_zero.docling_async_files
    SET status = CASE
          WHEN status = ${DOCLING_FILE_STATUS.Splitting} THEN ${DOCLING_FILE_STATUS.PendingSplit}
          WHEN status = ${DOCLING_FILE_STATUS.Writing} THEN ${DOCLING_FILE_STATUS.ReadyToWrite}
          ELSE status
        END,
        lease_owner = NULL, lease_token = NULL, lease_until = NULL,
        available_at = ${now}, updated_at = NOW()
    WHERE status IN (${DOCLING_FILE_STATUS.Splitting}, ${DOCLING_FILE_STATUS.Writing})
      AND lease_until IS NOT NULL
      AND lease_until < NOW()`;

  await db.$executeRaw`
    WITH expired AS (
      UPDATE non_zero.docling_async_parts
      SET status = ${DOCLING_PART_STATUS.Queued},
          lease_owner = NULL, lease_until = NULL, submit_permit_id = NULL,
          available_at = ${now}, updated_at = NOW()
      WHERE status = ${DOCLING_PART_STATUS.Submitting}
        AND lease_until IS NOT NULL
        AND lease_until < NOW()
      RETURNING file_id
    )
    UPDATE non_zero.docling_async_files f
    SET updated_at = NOW()
    FROM (
      SELECT file_id FROM expired GROUP BY file_id
    ) expired_counts
    WHERE f.file_id = expired_counts.file_id`;
};

export const listExpiredSubmittingDoclingParts = async (
  limit: number,
): Promise<DoclingPart[]> => {
  const rows = await db.$queryRaw<RawRow[]>`
    SELECT * FROM non_zero.docling_async_parts
    WHERE status = ${DOCLING_PART_STATUS.Submitting}
      AND lease_until IS NOT NULL
      AND lease_until < NOW()
      AND submit_permit_id IS NOT NULL
    ORDER BY lease_until ASC
    LIMIT ${Math.max(limit, 1)}`;
  return rows.map(partFromRow);
};

export const listTimedOutSubmittedDoclingParts = async (
  timeoutMs: number,
  limit: number,
): Promise<DoclingPart[]> => {
  const rows = await db.$queryRaw<RawRow[]>`
    SELECT * FROM non_zero.docling_async_parts
    WHERE status = ${DOCLING_PART_STATUS.Submitted}
      AND submitted_at IS NOT NULL
      AND submitted_at < NOW() - (${timeoutMs}::int * interval '1 millisecond')
    ORDER BY submitted_at ASC
    LIMIT ${Math.max(limit, 1)}`;
  return rows.map(partFromRow);
};

export type ClaimDoclingPartsForSubmitBatchInput = {
  workerId: string;
  permitIds: string[];
  leaseMs: number;
  perFileInflightPages: number;
  admittedPageBudget: number;
  maxParts: number;
};

export const claimDoclingPartsForSubmitBatch = async (
  input: ClaimDoclingPartsForSubmitBatchInput,
): Promise<DoclingPart[]> => {
  const permitIds = input.permitIds
    .filter((id) => id.length > 0)
    .slice(0, Math.max(Math.min(input.maxParts, 100), 1));

  if (permitIds.length === 0 || input.perFileInflightPages <= 0 || input.admittedPageBudget <= 0) {
    return [];
  }

  const attemptToken = randomUUID();
  const permitValues = permitIds.map((id, i) => `(${i + 1}, '${id.replace(/'/g, "''")}')`).join(', ');

  const rows = await db.$queryRaw<RawRow[]>`
    WITH ocr_page_budget_lock AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(672945, 42001)
    ),
    active_pages_by_file AS MATERIALIZED (
      SELECT
        active.file_id,
        SUM(GREATEST(COALESCE(active.page_count, GREATEST(active.end_page - active.start_page, 0)), 1)) AS active_pages
      FROM non_zero.docling_async_parts active
      WHERE active.status IN (${DOCLING_PART_STATUS.Submitting}, ${DOCLING_PART_STATUS.Submitted})
      GROUP BY active.file_id
    ),
    global_state AS (
      SELECT COALESCE(SUM(active_pages), 0) AS global_active_pages
      FROM active_pages_by_file
    ),
    candidate_files AS MATERIALIZED (
      SELECT
        f.file_id,
        COALESCE(ap.active_pages, 0) AS active_pages,
        gs.global_active_pages,
        COALESCE(f.priority_override, f.base_priority) AS file_priority,
        f.created_at
      FROM non_zero.docling_async_files f
      CROSS JOIN ocr_page_budget_lock
      CROSS JOIN global_state gs
      LEFT JOIN active_pages_by_file ap ON ap.file_id = f.file_id
      WHERE f.status = ${DOCLING_FILE_STATUS.OcrActive}
        AND (
          COALESCE(ap.active_pages, 0) < ${input.perFileInflightPages}
          OR COALESCE(ap.active_pages, 0) = 0
        )
        AND EXISTS (
          SELECT 1
          FROM non_zero.docling_async_parts queued
          WHERE queued.file_id = f.file_id
            AND queued.status = ${DOCLING_PART_STATUS.Queued}
            AND queued.available_at <= NOW()
        )
      ORDER BY COALESCE(f.priority_override, f.base_priority) DESC, f.created_at ASC, f.file_id ASC
      FOR UPDATE OF f SKIP LOCKED
    ),
    candidate_parts AS (
      SELECT
        cf.file_id,
        next_part.part_index,
        next_part.page_count,
        cf.active_pages,
        cf.global_active_pages,
        cf.file_priority,
        cf.created_at
      FROM candidate_files cf
      JOIN LATERAL (
        SELECT
          p.part_index,
          GREATEST(COALESCE(p.page_count, GREATEST(p.end_page - p.start_page, 0)), 1) AS page_count
        FROM non_zero.docling_async_parts p
        WHERE p.file_id = cf.file_id
          AND p.status = ${DOCLING_PART_STATUS.Queued}
          AND p.available_at <= NOW()
        ORDER BY p.part_index ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      ) next_part ON true
      WHERE (
        cf.active_pages + next_part.page_count <= ${input.perFileInflightPages}
        OR cf.active_pages = 0
      )
    ),
    eligible AS (
      SELECT *
      FROM candidate_parts
      WHERE (
        global_active_pages + page_count <= ${input.admittedPageBudget}
        OR global_active_pages = 0
      )
    ),
    ranked AS (
      SELECT
        file_id,
        part_index,
        page_count,
        global_active_pages,
        ROW_NUMBER() OVER (
          ORDER BY file_priority DESC, created_at ASC, file_id ASC, part_index ASC
        ) AS selected_rank,
        SUM(page_count) OVER (
          ORDER BY file_priority DESC, created_at ASC, file_id ASC, part_index ASC
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS cumulative_selected_pages
      FROM eligible
    ),
    selected AS (
      SELECT
        file_id,
        part_index,
        selected_rank
      FROM ranked
      WHERE (
          global_active_pages + cumulative_selected_pages <= ${input.admittedPageBudget}
          OR global_active_pages = 0
        )
      ORDER BY selected_rank
      LIMIT ${permitIds.length}
    ),
    selected_permits (selected_rank, permit_id) AS (
      VALUES ${Prisma.raw(permitValues)}
    ),
    claimed AS (
      UPDATE non_zero.docling_async_parts p
      SET status = ${DOCLING_PART_STATUS.Submitting},
          attempt_count = p.attempt_count + 1,
          current_job_id = 'docling:' || p.file_id || ':part:' || p.part_index || ':attempt:' || ${attemptToken} || '-' || selected.selected_rank::text,
          lease_owner = ${input.workerId},
          lease_until = NOW() + (${input.leaseMs}::int * interval '1 millisecond'),
          submit_permit_id = selected_permits.permit_id,
          submitted_at = NULL,
          ready_at = NULL,
          result_path = NULL,
          error_message = NULL,
          updated_at = NOW()
      FROM selected
      JOIN selected_permits ON selected_permits.selected_rank::int = selected.selected_rank::int
      WHERE p.file_id = selected.file_id
        AND p.part_index = selected.part_index
        AND p.status = ${DOCLING_PART_STATUS.Queued}
      RETURNING p.*
    )
    SELECT * FROM claimed
    ORDER BY part_index ASC`;
  return rows.map(partFromRow);
};

export const releaseClaimedDoclingPartForSubmitCapacity = async (input: {
  fileId: string;
  partIndex: number;
  jobId: string;
  errorMessage: string;
  availableAt: Date;
}): Promise<void> => {
  await db.$executeRaw`
    UPDATE non_zero.docling_async_parts
    SET status = ${DOCLING_PART_STATUS.Queued},
        current_job_id = NULL,
        attempt_count = GREATEST(attempt_count - 1, 0),
        available_at = ${input.availableAt},
        lease_owner = NULL,
        lease_until = NULL,
        submit_permit_id = NULL,
        error_message = ${input.errorMessage},
        updated_at = NOW()
    WHERE file_id = ${input.fileId}
      AND part_index = ${input.partIndex}
      AND current_job_id = ${input.jobId}
      AND status = ${DOCLING_PART_STATUS.Submitting}
      AND submitted_at IS NULL`;
};

export const listDeletedActiveDoclingFileIds = async (
  limit = 50,
): Promise<string[]> => {
  const rows = await db.$queryRaw<RawRow[]>`
    SELECT f.file_id
    FROM non_zero.docling_async_files f
    JOIN collection_items ci ON ci."fileId" = f.file_id
    WHERE ci."deletedAt" IS NOT NULL
      AND f.status NOT IN (${DOCLING_FILE_STATUS.Completed}, ${DOCLING_FILE_STATUS.Failed})
    ORDER BY ci."deletedAt" ASC, f.updated_at ASC
    LIMIT ${Math.max(limit, 1)}`;
  return rows.map((row) => String(row.file_id));
};

export const listLiveDoclingSubmitPermitIds = async (
  permitIds: string[],
): Promise<Set<string>> => {
  const unique = Array.from(new Set(permitIds.filter(Boolean)));
  if (unique.length === 0) return new Set();
  const rows = await db.$queryRaw<RawRow[]>`
    SELECT DISTINCT submit_permit_id
    FROM non_zero.docling_async_parts
    WHERE submit_permit_id = ANY(${unique}::text[])
      AND status IN (${DOCLING_PART_STATUS.Submitting}, ${DOCLING_PART_STATUS.Submitted})`;
  return new Set(
    rows
      .map((row) => row.submit_permit_id)
      .filter((id): id is string => typeof id === 'string'),
  );
};

export const listLiveDoclingCurrentJobIds = async (
  jobIds: string[],
): Promise<Set<string>> => {
  const unique = Array.from(new Set(jobIds.filter(Boolean)));
  if (unique.length === 0) return new Set();
  const rows = await db.$queryRaw<RawRow[]>`
    SELECT DISTINCT current_job_id
    FROM non_zero.docling_async_parts
    WHERE current_job_id = ANY(${unique}::text[])
      AND status IN (${DOCLING_PART_STATUS.Submitting}, ${DOCLING_PART_STATUS.Submitted})`;
  return new Set(
    rows
      .map((row) => row.current_job_id)
      .filter((id): id is string => typeof id === 'string'),
  );
};
