import Bull from 'bull';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
import { storageService } from '@/services/storage';
import { vespaQueue } from '@/queues/vespaQueue';
import { SubApp } from '@/vespa/src/types';
import { IngestionStatus } from '@xyne/shared';
import { CollectionRepository } from '@/database/repositories/collectionRepository';
import { getDriveAccessToken } from '@/services/driveTokenService';
import { downloadFile, DriveUnauthorizedError, type DriveFile } from '@/services/googleDriveImportService';
import { DuplicateStrategy } from '@/validators/fileUploadValidator';
import {
  markCollectionImportActive,
  clearCollectionImportActive,
  maybeNotifyCollectionIngestionCompleteByCollection,
} from '@/services/collectionIngestionNotifier';

/**
 * Background worker for Google Drive imports. The API request only lists the folder
 * and enqueues a job here; this worker downloads each file (as the user, via their
 * OAuth token), stores it, creates the CollectionItem, enqueues ingestion, and writes
 * per-file progress to Redis. The client polls that progress to fill the upload card
 * live — so a big folder never blocks (or times out) the HTTP request.
 */

const QUEUE_NAME = 'drive-import';
const PROGRESS_TTL_SECONDS = 3600;

export interface DriveImportJobData {
  collectionId: string;
  baseParentFolderId: string;
  files: DriveFile[];
  userId: string;
  workspaceId: string;
  sessionId: string;
  /** 'skip' | 'rename' | 'overwrite' */
  duplicateStrategy: string;
}

export type DriveImportFileStatus = 'pending' | 'uploaded' | 'skipped' | 'failed';

export interface DriveImportProgressFile {
  name: string;
  status: DriveImportFileStatus;
  error?: string;
}

export interface DriveImportProgress {
  collectionId: string;
  userId: string;
  total: number;
  processed: number;
  done: boolean;
  /** Set when the connected token was rejected mid-import → prompt a reconnect. */
  needsDriveAuth?: boolean;
  files: DriveImportProgressFile[];
}

const progressKey = (sessionId: string): string => `drive-import:${sessionId}`;

export async function writeDriveImportProgress(
  sessionId: string,
  progress: DriveImportProgress,
): Promise<void> {
  await redisService.set(progressKey(sessionId), JSON.stringify(progress), PROGRESS_TTL_SECONDS);
}

export async function readDriveImportProgress(
  sessionId: string,
): Promise<DriveImportProgress | null> {
  const raw = await redisService.get(progressKey(sessionId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DriveImportProgress;
  } catch {
    return null;
  }
}

// ── Bull queue ──────────────────────────────────────────────────────────────
let queue: Bull.Queue<DriveImportJobData> | null = null;

function getQueue(): Bull.Queue<DriveImportJobData> {
  if (!queue) {
    queue = new Bull<DriveImportJobData>(QUEUE_NAME, {
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        maxRetriesPerRequest: 3,
        ...(process.env.REDIS_PASSWORD && { password: process.env.REDIS_PASSWORD }),
        ...(process.env.REDIS_TLS === 'true' && { tls: { rejectUnauthorized: false } }),
      },
    });
  }
  return queue;
}

export async function enqueueDriveImport(data: DriveImportJobData): Promise<void> {
  await getQueue().add(data, { attempts: 1, removeOnComplete: true, removeOnFail: true });
}

/** Register the processor. Call once at startup in the process that runs downloads. */
export function startDriveImportWorker(): void {
  getQueue().process(1, async job => {
    await processDriveImportJob(job.data);
  });
  logger.info('[DRIVE_IMPORT] Worker started, ready to process jobs');
}

/** Close the queue connection (called on worker shutdown). */
export async function closeDriveImportQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = null;
  }
}

// ── helpers (mirror collectionController) ─────────────────────────────────────
const repo = new CollectionRepository();

async function ensureFolderPath(
  collectionId: string,
  filePath: string,
  baseParentFolderId: string,
  ownerId: string,
): Promise<string> {
  if (!filePath || filePath === '/') return baseParentFolderId;
  const collection = await repo.findCollectionById(collectionId);
  if (!collection) return baseParentFolderId;
  const parts = filePath.split('/').filter(p => p.trim() !== '');
  let currentFolderId = baseParentFolderId;
  for (const folderName of parts) {
    const existing = await repo.findFolderByName(currentFolderId, folderName);
    if (existing) {
      currentFolderId = existing.id;
      continue;
    }
    const newFolder = await repo.createFolder({
      parentFolderId: currentFolderId,
      name: folderName,
      ownerId,
      scopeType: collection.scopeType,
      scopeId: collection.scopeId,
    });
    currentFolderId = newFolder.id;
  }
  return currentFolderId;
}

function generateUniqueName(filename: string, existingNames: string[]): string {
  const existing = new Set(existingNames);
  if (!existing.has(filename)) return filename;
  const lastDot = filename.lastIndexOf('.');
  const base = lastDot !== -1 ? filename.slice(0, lastDot) : filename;
  const ext = lastDot !== -1 ? filename.slice(lastDot) : '';
  let counter = 1;
  let candidate = `${base} (${String(counter)})${ext}`;
  while (existing.has(candidate)) {
    counter += 1;
    candidate = `${base} (${String(counter)})${ext}`;
  }
  return candidate;
}

// ── the processor ─────────────────────────────────────────────────────────────
/**
 * Run one import job: download each file and write progress to Redis. Exported so the
 * controller can run it in-process as a fallback when the dedicated worker is disabled.
 */
export async function processDriveImportJob(data: DriveImportJobData): Promise<void> {
  const { collectionId, baseParentFolderId, files, userId, workspaceId, sessionId, duplicateStrategy } =
    data;

  const progress: DriveImportProgress = {
    collectionId,
    userId,
    total: files.length,
    processed: 0,
    done: false,
    files: files.map(f => ({ name: f.name, status: 'pending' as DriveImportFileStatus })),
  };
  await writeDriveImportProgress(sessionId, progress);

  // Suppress the "collection complete" notification while we're still creating files
  // (one-by-one), so it fires once at the very end — not after the first file lands.
  await markCollectionImportActive(collectionId);

  try {
    let token = await getDriveAccessToken(userId);

    for (let i = 0; i < files.length; i++) {
      const df = files[i];
      const pf = progress.files[i];
      try {
        if (!token) throw new DriveUnauthorizedError();

        let downloaded;
        try {
          downloaded = await downloadFile(df, token);
        } catch (err) {
          // Token expired/revoked mid-import — refresh once and retry this file.
          if (err instanceof DriveUnauthorizedError) {
            token = await getDriveAccessToken(userId);
            if (!token) throw err;
            downloaded = await downloadFile(df, token);
          } else {
            throw err;
          }
        }

        if (!downloaded) {
          pf.status = 'skipped';
          pf.error = 'unsupported-type';
          progress.processed += 1;
          await writeDriveImportProgress(sessionId, progress);
          continue;
        }

        const uploaded = await storageService.uploadFile(downloaded.buffer, {
          filename: downloaded.name,
          contentType: downloaded.contentType,
          scopeType: 'collection',
          scopeId: collectionId,
        });

        const parentFolderId = df.relPath
          ? await ensureFolderPath(collectionId, df.relPath, baseParentFolderId, userId)
          : baseParentFolderId;

        let finalFileName = downloaded.name;
        const existingItem = await repo.findItemByPath(parentFolderId, finalFileName);
        if (existingItem) {
          if (duplicateStrategy === DuplicateStrategy.SKIP) {
            await storageService.deleteFile(uploaded.path).catch(() => undefined);
            pf.status = 'skipped';
            pf.error = 'duplicate';
            progress.processed += 1;
            await writeDriveImportProgress(sessionId, progress);
            continue;
          } else if (duplicateStrategy === DuplicateStrategy.RENAME) {
            const siblings = await repo.findItemsByCollectionAndParentId(parentFolderId);
            finalFileName = generateUniqueName(finalFileName, siblings.map(s => s.name));
          } else if (duplicateStrategy === DuplicateStrategy.OVERWRITE) {
            await repo.softDeleteItem(existingItem.id);
          }
        }

        const item = await repo.createFileItem({
          rootCollectionId: collectionId,
          collectionId: parentFolderId,
          name: finalFileName,
          storageKey: uploaded.path,
          mimeType: downloaded.contentType,
          fileSize: uploaded.size,
          ownerId: userId,
          workspaceId,
          ingestionStatus: IngestionStatus.PENDING,
        });

        try {
          await vespaQueue.addJob({
            schema: 'file',
            docId: item.fileId,
            jobType: 'feed',
            userId,
            app: SubApp.COLLECTIONS,
          });
        } catch (e) {
          logger.warn('[DRIVE_IMPORT] Ingestion enqueue failed; file created but not indexed yet', {
            fileId: item.fileId,
            error: e instanceof Error ? e.message : String(e),
          });
        }

        pf.status = 'uploaded';
        progress.processed += 1;
        await writeDriveImportProgress(sessionId, progress);
      } catch (err) {
        pf.status = 'failed';
        pf.error = err instanceof Error ? err.message : 'Import failed';
        if (err instanceof DriveUnauthorizedError) progress.needsDriveAuth = true;
        progress.processed += 1;
        await writeDriveImportProgress(sessionId, progress);
        // df.name is an untrusted Drive file name — pass it as a structured field
        // rather than interpolating into the message (CodeQL js/log-injection).
        logger.error('[DRIVE_IMPORT] Failed to import file', { fileName: df.name, error: err });
      }
    }
  } finally {
    progress.done = true;
    await writeDriveImportProgress(sessionId, progress);
    // All files exist now — allow the completion notification, and cover the case where
    // the last file already finished ingesting while imports were still marked active.
    await clearCollectionImportActive(collectionId);
    await maybeNotifyCollectionIngestionCompleteByCollection(collectionId).catch(() => undefined);
    logger.info('[DRIVE_IMPORT] Import complete', {
      sessionId,
      collectionId,
      total: progress.total,
    });
  }
}
