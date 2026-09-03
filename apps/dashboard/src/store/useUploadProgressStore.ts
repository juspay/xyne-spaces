import { create } from 'zustand';

export interface UploadBatchProgress {
  total: number;
  current: number;
  batch: number;
  totalBatches: number;
}

export interface UploadFileStatus {
  id: string;
  name: string;
  status: 'pending' | 'uploading' | 'uploaded' | 'failed' | 'skipped';
  error?: string;
}

export interface UploadTask {
  id: string;
  collectionId: string;
  collectionName: string;
  isUploading: boolean;
  batchProgress: UploadBatchProgress;
  files: UploadFileStatus[];
  abortController: AbortController;
  /** Optional phase label shown in the card header instead of the default
   *  "Uploading X of Y files" (e.g. "Scanning Google Drive…" before the real
   *  file list is known). Cleared once the actual upload begins. */
  statusLabel?: string;
}

interface UploadProgressStore {
  currentUpload: UploadTask | null;
  startUpload: (
    collectionId: string,
    collectionName: string,
    files: { file: File; id: string }[],
    totalBatches: number,
    statusLabel?: string,
  ) => { uploadId: string; abortController: AbortController };
  updateProgress: (uploadId: string, current: number, batch: number) => void;
  updateFileStatus: (
    uploadId: string,
    fileName: string,
    fileId: string,
    status: 'pending' | 'uploading' | 'uploaded' | 'failed' | 'skipped',
    error?: string,
  ) => void;
  /** Mark upload as finished (keeps data for overlay display). */
  finishUpload: (uploadId: string) => void;
  /** Remove the upload from the store entirely (dismisses overlay). */
  clearUpload: (uploadId: string) => void;
  cancelUpload: (uploadId: string) => void;
  getUploadProgress: (uploadId: string) => UploadTask | null;
}

export const useUploadProgress = create<UploadProgressStore>((set, get) => ({
  currentUpload: null,

  startUpload: (collectionId, collectionName, files, totalBatches, statusLabel) => {
    const uploadId = `upload_${Date.now()}_${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`;
    const abortController = new AbortController();

    const uploadFiles: UploadFileStatus[] = files.map(file => ({
      id: file.id,
      name: file.file.name,
      status: 'pending' as const,
    }));

    const newUpload: UploadTask = {
      id: uploadId,
      collectionId,
      collectionName,
      isUploading: true,
      batchProgress: {
        total: files.length,
        current: 0,
        batch: 0,
        totalBatches,
      },
      files: uploadFiles,
      abortController,
      ...(statusLabel ? { statusLabel } : {}),
    };

    set({ currentUpload: newUpload });
    return { uploadId, abortController };
  },

  updateProgress: (uploadId, current, batch) => {
    set(state => {
      if (!state.currentUpload || state.currentUpload.id !== uploadId) {
        return state;
      }

      return {
        currentUpload: {
          ...state.currentUpload,
          batchProgress: {
            ...state.currentUpload.batchProgress,
            current,
            batch,
          },
        },
      };
    });
  },

  updateFileStatus: (uploadId, fileName, fileId, status, error) => {
    set(state => {
      if (!state.currentUpload || state.currentUpload.id !== uploadId) {
        return state;
      }

      return {
        currentUpload: {
          ...state.currentUpload,
          files: state.currentUpload.files.map(file =>
            file.name === fileName && file.id === fileId
              ? { ...file, status, ...(error && { error }) }
              : file,
          ),
        },
      };
    });
  },

  finishUpload: uploadId => {
    set(state => {
      if (!state.currentUpload || state.currentUpload.id !== uploadId) {
        return state;
      }
      return {
        currentUpload: { ...state.currentUpload, isUploading: false },
      };
    });
  },

  clearUpload: uploadId => {
    set(state => (state.currentUpload?.id === uploadId ? { currentUpload: null } : state));
  },

  cancelUpload: uploadId => {
    const uploadToCancel = get().currentUpload;
    if (uploadToCancel?.id === uploadId) {
      uploadToCancel.abortController.abort();
    }

    set(state => (state.currentUpload?.id === uploadId ? { currentUpload: null } : state));
  },

  getUploadProgress: uploadId => {
    const state = get();
    return state.currentUpload?.id === uploadId ? state.currentUpload : null;
  },
}));
