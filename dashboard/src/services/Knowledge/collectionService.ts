/**
 * Collection Service - API functions for knowledge collection management
 * Note: Backend endpoints are not yet implemented. These call placeholder APIs.
 */

import { apiInstance } from '../clients/apiClient';

// File/Folder types and interfaces
export type UploadStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
export type NodeType = 'FILE' | 'FOLDER';
export type CollectionRole = 'VIEWER' | 'EDITOR' | 'OWNER';

export interface CollectionChild {
  id: string;
  name: string;
  size: number;
  updatedAt: string;
  uploadStatus: UploadStatus;
  type: NodeType;
  mimeType: string;
  parentId: string | null;
  metadata: Record<string, unknown> | null;
}

export interface CollectionItemVersion {
  id: string | null; // null for the synthesized "current" entry
  itemId: string;
  versionNumber: number;
  mimeType: string;
  fileSize: number;
  checksum: string;
  uploadedById: string | null;
  uploadedByEmail: string | null;
  restoredFromVersionId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  isCurrent: boolean;
}

export interface GetCollectionChildResponse {
  items: CollectionChild[];
  total: number;
}

export interface FolderCounter {
  id: string;
  name: string;
  parentId: string | null;
  totalFiles: number;
  pendingFiles: number;
  processingFiles: number;
  completedFiles: number;
  failedFiles: number;
}

export interface GetFolderCountersResponse {
  success: boolean;
  collectionId: string;
  folderId: string;
  counter: FolderCounter | null;
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

export async function getKnowledgeCollections(
  projectId: string,
  userId: string,
  options?: { limit?: number; offset?: number },
): Promise<{ collections: CollectionSummary[]; total: number }> {
  const params = new URLSearchParams();
  if (options?.limit) params.append('limit', options.limit.toString());
  if (options?.offset) params.append('offset', options.offset.toString());

  const response = await apiInstance.get<{ collections: CollectionSummary[]; total: number }>(
    `/collections/project/${projectId}/${userId}${params.toString() ? `?${params.toString()}` : ''}`,
  );
  return response.data;
}

/**
 * Get user IDs that are members of the project (for share-collection UI).
 * Only these users should be listed when sharing a collection.
 */
export async function getProjectMemberIds(projectId: string): Promise<string[]> {
  const response = await apiInstance.get<{ success: boolean; userIds: string[] }>(
    `/collections/project/${projectId}/members`,
  );
  return response.data.userIds ?? [];
}

/**
 * Get all children (files and folders) of a collection
 * @param collectionId - The collection ID
 * @param options - Optional filters (parentId, limit, offset)
 */
export async function getCollectionChildren(
  collectionId: string,
  options?: {
    parentId?: string | null;
    limit?: number;
    offset?: number;
  },
): Promise<GetCollectionChildResponse> {
  const params = new URLSearchParams({ collectionId });
  if (options?.parentId !== undefined) {
    params.append('parentId', options.parentId || '');
  }
  if (options?.limit) params.append('limit', options.limit.toString());
  if (options?.offset) params.append('offset', options.offset.toString());

  const response = await apiInstance.get<{
    success: boolean;
    items: Array<{
      id: string;
      name: string;
      type: NodeType;
      createdAt: string;
      updatedAt: string;
      uploadedByEmail: string;
      uploadStatus: UploadStatus;
      fileSize: string; // API returns as string
      mimeType: string;
      parentId?: string | null;
    }>;
    total?: number;
  }>(`/collections/${collectionId}/items${params.toString() ? `?${params.toString()}` : ''}`);

  // Map API response to CollectionChild interface
  // Convert fileSize (string) to size (number) and handle missing fields
  const items: CollectionChild[] = response.data.items.map(item => ({
    id: item.id,
    name: item.name,
    type: item.type,
    updatedAt: item.updatedAt,
    uploadStatus: item.uploadStatus,
    size: item.fileSize ? parseInt(item.fileSize, 10) || 0 : 0,
    mimeType: item.mimeType,
    parentId: item.parentId ?? null,
    metadata: null,
  }));

  return {
    items,
    total: response.data.total ?? items.length,
  };
}

/**
 * Get folder counters for a single folder by its id.
 * @param collectionId - The collection ID
 * @param folderId - The folder ID
 */
export async function getFolderCountersByFolderId(
  collectionId: string,
  folderId: string,
): Promise<GetFolderCountersResponse> {
  const response = await apiInstance.get<GetFolderCountersResponse>(
    `/collections/${collectionId}/folder-counters/${folderId}`,
  );
  return response.data;
}

/**
 * Get an item and all its ancestors up to the collection root.
 * Used to hydrate the tree context on deep-link/page refresh when intermediate nodes are unknown.
 * Returns items ordered from the target item up to the root-level ancestor:
 * [item, parent, grandparent, ..., root-level-ancestor]
 * @param itemId - The target item ID (typically a folder)
 * @param collectionId - The collection this item belongs to
 */
export async function getItemAncestors(
  itemId: string,
  collectionId: string,
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
      uploadStatus: UploadStatus;
      fileSize: string;
      mimeType: string;
      parentId: string | null;
    }>;
  }>(`/collections/items/${itemId}/ancestors`, {
    params: { collectionId },
  });

  return response.data.items.map(item => ({
    id: item.id,
    name: item.name,
    type: item.type,
    updatedAt: item.updatedAt,
    uploadStatus: item.uploadStatus,
    size: item.fileSize ? parseInt(item.fileSize, 10) || 0 : 0,
    mimeType: item.mimeType,
    parentId: item.parentId ?? null,
    metadata: null,
  }));
}

/**
 * Search items in a collection by name or title
 * @param collectionId - The collection ID
 * @param query - The search query string
 */
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
      uploadStatus: UploadStatus;
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
    uploadStatus: item.uploadStatus,
    size: item.fileSize ? parseInt(item.fileSize, 10) || 0 : 0,
    mimeType: item.mimeType,
    parentId: item.parentId ?? null,
    metadata: null,
  }));
}

/** Minimal type for a failed upload item (all are files) */
export interface FailedCollectionItem {
  id: string;
  name: string;
  parentId: string | null;
  statusMessage?: string | null;
}

/**
 * Get list of items with FAILED upload status in a collection
 */
export async function getFailedCollectionItems(
  collectionId: string,
): Promise<FailedCollectionItem[]> {
  const response = await apiInstance.get<{
    success: boolean;
    items: Array<{
      id: string;
      name: string;
      parentId: string | null;
      statusMessage?: string | null;
    }>;
  }>(`/collections/${collectionId}/failed-items`);

  return (response.data.items ?? []).map(item => ({
    id: item.id,
    name: item.name,
    parentId: item.parentId ?? null,
    statusMessage: item.statusMessage ?? null,
  }));
}

/**
 * Get file content with metadata
 * This combines metadata and content fetching into a single call
 * @param fileId - The file ID
 * @returns Object containing the blob and metadata
 */
export async function getFileContent(fileId: string): Promise<{
  blob: Blob;
  metadata: {
    id: string;
    name: string;
    size: number;
    mimeType: string;
  };
}> {
  // Request metadata along with file content
  const response = await apiInstance.get<{
    success: boolean;
    metadata: {
      id: string;
      name: string;
      size: number;
      mimeType: string;
    };
    content: string; // base64 encoded
  }>(`/collections/items/${fileId}/content`, {
    params: {
      withMetadata: 'true',
    },
  });

  // Convert base64 string to Blob
  const base64Data = response.data.content;
  const byteCharacters = atob(base64Data);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray], { type: response.data.metadata.mimeType });

  return {
    blob,
    metadata: response.data.metadata,
  };
}

/**
 * Upload files to a collection (single batch)
 * @param collectionId - The collection ID
 * @param files - Array of files to upload
 * @param parentId - Optional parent folder ID (null for root)
 * @param duplicateStrategy - How to handle duplicates: 'skip' | 'rename' | 'overwrite'
 * @param onProgress - Optional progress callback
 * @param sessionId - Optional session ID for backend batch tracking / metadata
 * @param isBdTeam - Optional flag for BD team upload (enables CSV parsing for slide URLs)
 */
export async function uploadFilesToCollection(
  collectionId: string,
  files: File[],
  parentId?: string | null,
  duplicateStrategy: 'skip' | 'rename' | 'overwrite' = 'rename',
  onProgress?: (progress: { uploaded: number; total: number; currentFile?: string }) => void,
  sessionId?: string,
  isBdTeam?: boolean,
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
  if (isBdTeam) {
    formData.append('isBdTeam', 'true');
  }

  // Extract file paths (webkitRelativePath for folder uploads, or empty string for single files)
  // The backend uses these paths to create folder structure via ensureFolderPath
  const paths: string[] = files.map((file): string => {
    // webkitRelativePath is set when files are selected from a folder (e.g., via <input webkitdirectory>)
    // It contains the relative path like "folder1/file.txt" or "folder1/subfolder/file.txt"
    // Type assertion needed because webkitRelativePath is not in the standard File interface
    const fileWithPath = file as File & { webkitRelativePath?: string };
    const relativePath = fileWithPath.webkitRelativePath || '';
    // Remove the filename from the path (backend expects just the folder path)
    if (typeof relativePath === 'string' && relativePath.length > 0) {
      const pathParts = relativePath.split('/');
      pathParts.pop(); // Remove filename
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

/**
 * Upload files in batches with progress tracking
 * @param collectionId - The collection ID
 * @param files - Array of files to upload
 * @param parentId - Optional parent folder ID (null for root)
 * @param duplicateStrategy - How to handle duplicates
 * @param onProgress - Progress callback for each file
 * @param sessionId - Optional session ID for backend batch tracking / metadata
 * @param isBdTeam - Optional flag for BD team upload (enables CSV parsing for slide URLs)
 */
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
  isBdTeam?: boolean,
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
        isBdTeam,
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

/**
 * Download a single file
 * @param fileId - The file ID
 * @param fileName - The file name for the download
 * @returns Blob of the file content
 */
export async function downloadFile(fileId: string, fileName: string): Promise<void> {
  const response = await apiInstance.get(`/collections/items/${fileId}/download`, {
    responseType: 'blob',
  });

  // Create a blob URL and trigger download
  const blob = new Blob([response.data]);
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

/**
 * Update entity tags for an item
 * @param itemId - The item ID
 * @param entityTags - The entity tags to update
 */
export async function updateItemTags(
  itemId: string,
  entityTags: {
    people: string[];
    productSpecifications: string[];
    merchants: string[];
  },
): Promise<{ success: boolean; item: { id: string; metadata: Record<string, unknown> } }> {
  const response = await apiInstance.patch<{
    success: boolean;
    item: { id: string; metadata: Record<string, unknown> };
  }>(`/collections/items/${itemId}/tags`, { entityTags });
  return response.data;
}

/**
 * Download a folder as a zip file
 * @param folderId - The folder ID
 * @param folderName - The folder name for the zip file
 * @returns Blob of the zip content
 */
export async function downloadFolder(folderId: string, folderName: string): Promise<void> {
  const response = await apiInstance.get(`/collections/items/${folderId}/download-folder`, {
    responseType: 'blob',
  });

  // Create a blob URL and trigger download
  const blob = new Blob([response.data], { type: 'application/zip' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${folderName}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

export async function uploadNewVersion(
  itemId: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<{ success: boolean; versionNumber: number }> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await apiInstance.post<{ success: boolean; versionNumber: number }>(
    `/collections/items/${itemId}/versions`,
    formData,
    {
      onUploadProgress: progressEvent => {
        if (onProgress && progressEvent.total) {
          onProgress(Math.round((progressEvent.loaded / progressEvent.total) * 100));
        }
      },
    },
  );
  return response.data;
}

export async function getItemVersions(itemId: string): Promise<CollectionItemVersion[]> {
  const response = await apiInstance.get<{ success: boolean; versions: CollectionItemVersion[] }>(
    `/collections/items/${itemId}/versions`,
  );
  return response.data.versions;
}

export async function restoreItemVersion(
  itemId: string,
  versionId: string,
): Promise<{ success: boolean; versionNumber: number }> {
  const response = await apiInstance.post<{ success: boolean; versionNumber: number }>(
    `/collections/items/${itemId}/versions/${versionId}/restore`,
  );
  return response.data;
}

export async function downloadItemVersion(
  itemId: string,
  versionId: string,
  fileName: string,
): Promise<void> {
  const response = await apiInstance.get(
    `/collections/items/${itemId}/versions/${versionId}/download`,
    { responseType: 'blob' },
  );

  const blob = new Blob([response.data as BlobPart]);
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}
