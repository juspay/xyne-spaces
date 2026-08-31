import { apiInstance } from '../clients/apiClient';
import { IngestionStatus } from '@xyne/shared';

export type { IngestionStatus };
export type NodeType = 'FILE' | 'FOLDER';
export type CollectionRole = 'VIEWER' | 'EDITOR' | 'OWNER';

/** The backend's own item-type vocabulary (lowercase, e.g. searchItems'
 *  itemType field) — distinct from NodeType (the frontend's normalized,
 *  uppercase vocabulary). Named so toNodeType can switch over it exhaustively:
 *  if this union ever grows, toNodeType fails to compile until it's updated,
 *  instead of the new value silently falling through to 'FILE'. */
export type BackendItemType = 'file' | 'folder';

function toNodeType(itemType: BackendItemType): NodeType {
  switch (itemType) {
    case 'file':
      return 'FILE';
    case 'folder':
      return 'FOLDER';
  }
}

export interface CollectionChild {
  id: string;
  name: string;
  size: number;
  updatedAt: string;
  ingestionStatus: IngestionStatus | null;
  type: NodeType;
  mimeType: string;
  parentId: string | null;
  /** Per-collection ingestion rollup, only populated for collections at the KB
   *  root (see useGlobalCollections). Undefined for files and subfolders. */
  fileTotal?: number;
  fileIngested?: number;
  fileFailed?: number;
}

export interface CollectionItemVersion {
  id: string | null; // null for the synthesized "current" entry
  itemId: string;
  versionNumber: number;
  mimeType: string;
  fileSize: number;
  uploadedById: string | null;
  uploadedByEmail: string | null;
  restoredFromVersionId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  isCurrent: boolean;
}

export interface FailedCollectionItem {
  id: string;
  name: string;
  parentId: string | null;
  statusMessage?: string | null;
}

export interface CollectionSummary {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  canShare: boolean;
  role: CollectionRole;
}

export const BATCH_CONFIG = {
  MAX_PAYLOAD_SIZE: 50 * 1024 * 1024, // 50MB per batch
  MAX_FILES_PER_BATCH: 20,
};

export function createBatches(files: File[]): File[][] {
  const batches: File[][] = [];
  let currentBatch: File[] = [];
  let currentBatchSize = 0;

  for (const file of files) {
    const fileOverhead = file.size + file.name.length * 2 + 200;
    const newBatchSize = currentBatchSize + fileOverhead;

    if (
      currentBatch.length > 0 &&
      (newBatchSize > BATCH_CONFIG.MAX_PAYLOAD_SIZE ||
        currentBatch.length >= BATCH_CONFIG.MAX_FILES_PER_BATCH)
    ) {
      batches.push([...currentBatch]);
      currentBatch = [file];
      currentBatchSize = fileOverhead;
    } else {
      currentBatch.push(file);
      currentBatchSize = newBatchSize;
    }
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

export async function searchCollectionItems(
  collectionId: string,
  query: string,
): Promise<CollectionChild[]> {
  // The backend's search response shape doesn't match CollectionChild's field
  // names — it sends `itemType: 'folder' | 'file'` (lowercase, not `type`)
  // and `collectionId` (the item's containing folder, same field name Zero's
  // synced schema uses everywhere else — see CollectionTreeDataSync's
  // filesByFolder map) rather than `parentId`. Mapped explicitly below
  // instead of trusting a response type that never matched reality.
  const response = await apiInstance.get<{
    success: boolean;
    items: Array<{
      id: string;
      name: string;
      itemType: BackendItemType;
      createdAt: string;
      updatedAt: string;
      ingestionStatus: IngestionStatus;
      fileSize: string | null;
      mimeType: string | null;
      collectionId: string;
    }>;
    query: string;
  }>(`/collections/${collectionId}/search`, {
    params: { query },
  });

  return response.data.items.map(item => ({
    id: item.id,
    name: item.name,
    type: toNodeType(item.itemType),
    updatedAt: item.updatedAt,
    ingestionStatus: item.ingestionStatus,
    size: item.fileSize ? parseInt(item.fileSize, 10) || 0 : 0,
    mimeType: item.mimeType ?? '',
    // Root-level items' collectionId equals the collection being searched —
    // normalize that to null to match CollectionChild.parentId's
    // "root has no parent" convention used everywhere else.
    parentId: item.collectionId === collectionId ? null : item.collectionId,
  }));
}

export async function uploadFilesToCollection(
  collectionId: string,
  files: File[],
  parentId?: string | null,
  duplicateStrategy: 'skip' | 'rename' | 'overwrite' = 'rename',
  onProgress?: (progress: { uploaded: number; total: number; currentFile?: string }) => void,
  sessionId?: string,
  stripTopFolderSegment: boolean = false,
): Promise<{
  success: boolean;
  uploaded: number;
  failed: number;
  results: Array<{
    fileName: string;
    itemId?: string;
    status: 'success' | 'skipped' | 'failed';
    error?: string;
  }>;
  errors?: Array<{ fileName: string; error: string }>;
}> {
  const formData = new FormData();
  formData.append('collectionId', collectionId);
  formData.append('duplicateStrategy', duplicateStrategy);
  if (parentId !== undefined && parentId !== null) {
    formData.append('parentId', parentId);
  }
  if (sessionId) {
    formData.append('sessionId', sessionId);
  }
  const paths: string[] = files.map((file): string => {
    const fileWithPath = file as File & { webkitRelativePath?: string };
    const relativePath = fileWithPath.webkitRelativePath || '';
    // Remove the filename from the path (backend expects just the folder path)
    if (typeof relativePath === 'string' && relativePath.length > 0) {
      const pathParts = relativePath.split('/');
      pathParts.pop(); // Remove filename
      if (stripTopFolderSegment && pathParts.length > 0) {
        // The caller is using the top-level folder name as the collection name,
        // so drop it here to avoid creating a duplicate sub-folder of the same name.
        pathParts.shift();
      }
      return pathParts.join('/');
    }
    return '';
  });

  // Send paths as JSON array (backend expects this to maintain folder structure)
  if (paths.some(p => p !== '')) {
    formData.append('paths', JSON.stringify(paths));
  }

  files.forEach(file => formData.append('files', file));

  // Track progress
  if (onProgress) {
    onProgress({ uploaded: 0, total: files.length });
  }

  const response = await apiInstance.post<{
    success: boolean;
    uploaded: number;
    failed: number;
    results: Array<{
      fileName: string;
      itemId?: string;
      status: 'success' | 'skipped' | 'failed';
      error?: string;
    }>;
    errors?: Array<{ fileName: string; error: string }>;
  }>(`/collections/${collectionId}/upload`, formData, {
    onUploadProgress: progressEvent => {
      if (onProgress && progressEvent.total) {
        const uploaded = Math.round((progressEvent.loaded / progressEvent.total) * files.length);
        onProgress({ uploaded: Math.min(uploaded, files.length), total: files.length });
      }
    },
  });

  // Final progress update
  if (onProgress) {
    onProgress({ uploaded: files.length, total: files.length });
  }

  return response.data;
}

/** Returned by addDriveLinkToCollection once the import is enqueued. */
export interface DriveImportStarted {
  /** null when there was nothing to import. */
  sessionId: string | null;
  total: number;
  files: Array<{ name: string }>;
}

export type DriveImportFileStatus = 'pending' | 'uploaded' | 'skipped' | 'failed';

/** Live progress of a background Drive import (polled from the status endpoint). */
export interface DriveImportProgress {
  collectionId: string;
  total: number;
  processed: number;
  done: boolean;
  /** Set when the connected token was rejected mid-import → prompt a reconnect. */
  needsDriveAuth?: boolean;
  files: Array<{ name: string; status: DriveImportFileStatus; error?: string }>;
}

/**
 * Ask the backend for the Google Drive OAuth "connect" URL. Uses OAuth incremental
 * authorization, so an already-signed-in Google user just approves the Drive scope —
 * no re-login. `returnPath` is the same-origin SPA path (e.g. the current KB URL) the
 * backend redirects back to after consent, with `?driveOAuth=success` appended.
 */
export async function initDriveOAuth(returnPath: string): Promise<{ authUrl?: string }> {
  const { data } = await apiInstance.post<{ success: boolean; authUrl?: string }>(
    '/drive/oauth/google/init',
    { returnPath },
  );
  return data.authUrl ? { authUrl: data.authUrl } : {};
}

/**
 * Start a Google Drive import. The server lists the file/folder (as the user, via their
 * connected OAuth token), enqueues a background download job, and returns a `sessionId` +
 * the file list immediately. Poll {@link getDriveImportStatus} for live progress. If the
 * user hasn't connected Drive, the request fails with `needsDriveAuth: true` on the error.
 */
export async function addDriveLinkToCollection(
  collectionId: string,
  driveUrl: string,
  opts?: {
    parentId?: string | null;
    duplicateStrategy?: 'skip' | 'rename' | 'overwrite';
  },
): Promise<DriveImportStarted> {
  const response = await apiInstance.post<DriveImportStarted>(
    `/collections/${collectionId}/upload-drive-link`,
    {
      driveUrl,
      parentId: opts?.parentId ?? null,
      duplicateStrategy: opts?.duplicateStrategy ?? 'rename',
    },
  );
  return response.data;
}

/** Poll the progress of a background Drive import started above. */
export async function getDriveImportStatus(
  collectionId: string,
  sessionId: string,
): Promise<DriveImportProgress> {
  const response = await apiInstance.get<DriveImportProgress>(
    `/collections/${collectionId}/drive-import/${sessionId}`,
  );
  return response.data;
}

export async function uploadFilesInBatches(
  collectionId: string,
  files: File[],
  parentId?: string | null,
  duplicateStrategy: 'skip' | 'rename' | 'overwrite' = 'rename',
  onProgress?: (progress: {
    fileIndex: number;
    fileName: string;
    status: 'uploading' | 'success' | 'failed' | 'skipped';
    error?: string;
    batchProgress: { currentBatch: number; totalBatches: number };
  }) => void,
  sessionId?: string,
  stripTopFolderSegment: boolean = false,
): Promise<{
  success: boolean;
  totalUploaded: number;
  totalSkipped: number;
  totalFailed: number;
  results: Array<{
    fileName: string;
    itemId?: string;
    status: 'success' | 'skipped' | 'failed';
    error?: string;
  }>;
  errors?: Array<{ fileName: string; error: string }>;
}> {
  const batches = createBatches(files);
  let totalUploaded = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  const allResults: Array<{
    fileName: string;
    itemId?: string;
    status: 'success' | 'skipped' | 'failed';
    error?: string;
  }> = [];
  const allErrors: Array<{ fileName: string; error: string }> = [];

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    if (!batch || batch.length === 0) continue;

    // Notify batch start
    batch.forEach((file, fileIndexInBatch) => {
      const globalFileIndex =
        batches.slice(0, batchIndex).reduce((sum, b) => sum + (b?.length ?? 0), 0) +
        fileIndexInBatch;
      onProgress?.({
        fileIndex: globalFileIndex,
        fileName: file.name,
        status: 'uploading',
        batchProgress: { currentBatch: batchIndex + 1, totalBatches: batches.length },
      });
    });

    try {
      const result = await uploadFilesToCollection(
        collectionId,
        batch,
        parentId,
        duplicateStrategy,
        undefined, // Batch-level progress handled separately
        sessionId,
        stripTopFolderSegment,
      );

      // Process results
      result.results.forEach((fileResult, index) => {
        const file = batch[index];
        if (!file) return;

        const globalFileIndex =
          batches.slice(0, batchIndex).reduce((sum, b) => sum + (b?.length ?? 0), 0) + index;

        if (fileResult.status === 'success') {
          totalUploaded++;
          onProgress?.({
            fileIndex: globalFileIndex,
            fileName: file.name,
            status: 'success',
            batchProgress: { currentBatch: batchIndex + 1, totalBatches: batches.length },
          });
        } else if (fileResult.status === 'skipped') {
          totalSkipped++;
          onProgress?.({
            fileIndex: globalFileIndex,
            fileName: file.name,
            status: 'skipped',
            batchProgress: { currentBatch: batchIndex + 1, totalBatches: batches.length },
          });
        } else {
          totalFailed++;
          onProgress?.({
            fileIndex: globalFileIndex,
            fileName: file.name,
            status: 'failed',
            ...(fileResult.error && { error: fileResult.error }),
            batchProgress: { currentBatch: batchIndex + 1, totalBatches: batches.length },
          });
        }

        allResults.push(fileResult);
      });

      if (result.errors) {
        allErrors.push(...result.errors);
      }
    } catch (error) {
      // Mark entire batch as failed
      batch.forEach((file, index) => {
        if (!file) return;

        const globalFileIndex =
          batches.slice(0, batchIndex).reduce((sum, b) => sum + (b?.length ?? 0), 0) + index;
        const errorMessage = error instanceof Error ? error.message : 'Upload failed';
        totalFailed++;
        allResults.push({
          fileName: file.name,
          status: 'failed',
          error: errorMessage,
        });
        onProgress?.({
          fileIndex: globalFileIndex,
          fileName: file.name,
          status: 'failed',
          error: errorMessage,
          batchProgress: { currentBatch: batchIndex + 1, totalBatches: batches.length },
        });
      });
    }
  }

  return {
    success: totalFailed === 0,
    totalUploaded,
    totalSkipped,
    totalFailed,
    results: allResults,
    ...(allErrors.length > 0 && { errors: allErrors }),
  };
}
