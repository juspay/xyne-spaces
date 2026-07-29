import { useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { useUploadProgress } from '../../../store/useUploadProgressStore';
import { createBatches } from '../../../services/Knowledge/collectionService';

/**
 * Aggregate result counts from an upload operation.
 * Callers can supply explicit counts (e.g. from `uploadFilesInBatches`)
 * or omit them to let the hook derive counts from the global store.
 */
export interface UploadResultCounts {
  totalUploaded: number;
  totalSkipped: number;
  totalFailed: number;
}

/**
 * useUploadHandler – shared upload-progress orchestration for every
 * modal / component that uploads files via the collection service.
 *
 * Responsibilities:
 *  • Initialises global upload tracking (zustand store)
 *  • Generates a per-upload `sessionId` for the backend
 *  • Builds the progress callback expected by `uploadFilesInBatches`
 *  • Maps raw service progress → store-compatible status updates
 *  • Handles completion toasts and error recovery
 *  • Exposes `cancel` to abort in-flight uploads
 *
 * The floating `<GlobalUploadProgress />` overlay reads directly from
 * the store, so modals can close immediately after calling `initUpload`.
 */
export function useUploadHandler() {
  const uploadIdRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  // ── Store actions ─────────────────────────────────────────────────
  const startUpload = useUploadProgress(s => s.startUpload);
  const updateProgress = useUploadProgress(s => s.updateProgress);
  const updateFileStatus = useUploadProgress(s => s.updateFileStatus);
  const finishUpload = useUploadProgress(s => s.finishUpload);
  const cancelUpload = useUploadProgress(s => s.cancelUpload);

  // ── initUpload ────────────────────────────────────────────────────
  /**
   * Call this *before* uploading. It:
   *  1. Creates batches for progress tracking
   *  2. Registers the upload in the global store
   *  3. Generates a unique `sessionId` for the backend
   *
   * @returns `{ uploadId, sessionId, batches }` that callers thread
   *          into `createProgressCallback` and the service functions.
   */
  const initUpload = useCallback(
    (collectionId: string, collectionName: string, files: File[]) => {
      const batches = createBatches(files);

      const filesWithIds = files.map(file => ({
        file,
        id: `${file.name}-${file.size}-${file.lastModified}`,
      }));

      const sessionId =
        crypto.randomUUID?.() ?? `session_${Date.now()}_${Math.random().toString(36).slice(2)}`;

      const { uploadId } = startUpload(collectionId, collectionName, filesWithIds, batches.length);

      uploadIdRef.current = uploadId;
      sessionIdRef.current = sessionId;

      return { uploadId, sessionId, batches };
    },
    [startUpload],
  );

  // ── createProgressCallback ────────────────────────────────────────
  /**
   * Returns a progress callback that can be passed directly to
   * `uploadFilesInBatches` / `createKnowledgeCollection`.
   *
   * It translates per-file service events into global store updates.
   */
  const createProgressCallback = useCallback(
    (uploadId: string, files: File[], batches: File[][]) => {
      let processedCount = 0;
      let currentBatchNum = 0;

      return (progress: {
        fileIndex: number;
        fileName: string;
        status: 'uploading' | 'success' | 'failed' | 'skipped';
        error?: string;
        batchProgress: { currentBatch: number; totalBatches: number };
      }) => {
        const matchedFile = files.find(f => f.name === progress.fileName);
        const fileId = `${progress.fileName}-${matchedFile?.size ?? 0}-${matchedFile?.lastModified ?? 0}`;

        // Map service status → store status
        const storeStatus: 'pending' | 'uploading' | 'uploaded' | 'failed' | 'skipped' =
          progress.status === 'success'
            ? 'uploaded'
            : progress.status === 'skipped'
              ? 'skipped'
              : progress.status === 'failed'
                ? 'failed'
                : 'uploading';

        updateFileStatus(uploadId, progress.fileName, fileId, storeStatus, progress.error);

        // Update batch counters
        const isTerminal =
          progress.status === 'success' ||
          progress.status === 'skipped' ||
          progress.status === 'failed';

        if (progress.batchProgress.currentBatch !== currentBatchNum) {
          currentBatchNum = progress.batchProgress.currentBatch;
          processedCount =
            batches.slice(0, currentBatchNum - 1).reduce((sum, batch) => sum + batch.length, 0) +
            (isTerminal ? 1 : 0);
          updateProgress(uploadId, processedCount, currentBatchNum);
        } else if (isTerminal) {
          processedCount++;
          updateProgress(uploadId, processedCount, currentBatchNum);
        }
      };
    },
    [updateFileStatus, updateProgress],
  );

  // ── completeUpload ────────────────────────────────────────────────
  /**
   * Call after a successful upload. Marks the upload as finished in the
   * store (the overlay will display the completion state and eventually
   * auto-dismiss for fully-successful uploads).
   * @param uploadId - The upload ID
   * @param counts - Optional upload result counts
   * @param customMessage - Optional custom success message (e.g., "Pitch Uploaded Successfully")
   */
  const completeUpload = useCallback(
    (uploadId: string, counts?: UploadResultCounts, customMessage?: string) => {
      // Show a toast as a secondary notification
      let uploaded: number;
      let skipped: number;
      let failed: number;

      if (counts) {
        uploaded = counts.totalUploaded;
        skipped = counts.totalSkipped;
        failed = counts.totalFailed;
      } else {
        const storeFiles = useUploadProgress.getState().currentUpload?.files ?? [];
        uploaded = storeFiles.filter(f => f.status === 'uploaded').length;
        skipped = storeFiles.filter(f => f.status === 'skipped').length;
        failed = storeFiles.filter(f => f.status === 'failed').length;
      }

      // Use custom message if provided, otherwise generate default message
      let message: string;
      if (customMessage) {
        message = customMessage;
      } else {
        const details: string[] = [];
        if (uploaded > 0) details.push(`${uploaded} file${uploaded !== 1 ? 's' : ''} uploaded`);
        if (skipped > 0) details.push(`${skipped} duplicate${skipped !== 1 ? 's' : ''} skipped`);
        if (failed > 0) details.push(`${failed} failed`);
        message =
          details.length > 0 ? `Upload complete: ${details.join(', ')}.` : 'Upload complete.';
      }

      if (failed === 0) {
        toast.success(message);
      } else if (uploaded > 0) {
        toast.warning(message);
      } else {
        toast.error('All files failed to upload. Please try again.');
      }

      // Mark done (keeps data visible in the overlay)
      finishUpload(uploadId);
      uploadIdRef.current = null;
      sessionIdRef.current = null;
    },
    [finishUpload],
  );

  // ── handleError ───────────────────────────────────────────────────
  /**
   * Call when the upload promise rejects. Shows an error toast, marks
   * remaining files as failed, and finishes the upload.
   */
  const handleError = useCallback(
    (uploadId: string, error: unknown) => {
      if (error instanceof Error && error.name === 'AbortError') {
        toast.info('Upload was cancelled.');
      } else {
        toast.error(
          error instanceof Error ? error.message : 'Failed to upload files. Please try again.',
        );
      }

      // Mark all pending/uploading files as failed
      const remaining = useUploadProgress.getState().currentUpload?.files ?? [];
      remaining.forEach(file => {
        if (file.status === 'pending' || file.status === 'uploading') {
          updateFileStatus(uploadId, file.name, file.id, 'failed', 'Upload failed');
        }
      });

      finishUpload(uploadId);
      uploadIdRef.current = null;
      sessionIdRef.current = null;
    },
    [finishUpload, updateFileStatus],
  );

  // ── cancel ────────────────────────────────────────────────────────
  const cancel = useCallback(() => {
    if (uploadIdRef.current) {
      cancelUpload(uploadIdRef.current);
    }
    uploadIdRef.current = null;
    sessionIdRef.current = null;
  }, [cancelUpload]);

  return {
    // Actions
    initUpload,
    createProgressCallback,
    completeUpload,
    handleError,
    cancel,
  };
}
