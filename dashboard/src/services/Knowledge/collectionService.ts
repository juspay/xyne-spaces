import { apiInstance } from '../clients/apiClient';
import { IngestionStatus } from '@xyne/shared';

export type { IngestionStatus };
export type NodeType = 'FILE' | 'FOLDER';
export type CollectionRole = 'VIEWER' | 'EDITOR' | 'OWNER';

export interface CollectionChild {
  id: string;
  name: string;
  size: number;
  updatedAt: string;
  ingestionStatus: IngestionStatus | null;
  type: NodeType;
  mimeType: string;
  parentId: string | null;
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
  const response = await apiInstance.get<{
    success: boolean;
    items: Array<{
      id: string;
      name: string;
      type: NodeType;
      createdAt: string;
      updatedAt: string;
      uploadedByEmail: string;
      ingestionStatus: IngestionStatus;
      fileSize: string;
      mimeType: string;
      parentId: string | null;
    }>;
    query: string;
  }>(`/collections/${collectionId}/search`, {
    params: { query },
  });

  return response.data.items.map(item => ({
    id: item.id,
    name: item.name,
    type: item.type,
    updatedAt: item.updatedAt,
    ingestionStatus: item.ingestionStatus,
    size: item.fileSize ? parseInt(item.fileSize, 10) || 0 : 0,
    mimeType: item.mimeType,
    parentId: item.parentId ?? null,
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
