import { create } from 'zustand';
import { nextUploadPhase, type AttachmentUploadState } from '../utils/attachmentUploadProgress';

interface AttachmentUploadStore {
  uploads: Record<string, AttachmentUploadState>;
  start: (attachmentId: string, total: number) => void;
  progress: (attachmentId: string, loaded: number, total: number) => void;
  fail: (attachmentId: string, error: string) => void;
  clear: (attachmentIds: readonly string[]) => void;
}

export const useAttachmentUploadStore = create<AttachmentUploadStore>()(set => ({
  uploads: {},
  start: (attachmentId, total) =>
    set(state => ({
      uploads: { ...state.uploads, [attachmentId]: { phase: 'uploading', loaded: 0, total } },
    })),
  progress: (attachmentId, loaded, total) =>
    set(state => {
      const current = state.uploads[attachmentId];
      if (!current || current.phase === 'failed') return state;
      return {
        uploads: {
          ...state.uploads,
          [attachmentId]: { phase: nextUploadPhase(loaded, total), loaded, total },
        },
      };
    }),
  fail: (attachmentId, error) =>
    set(state => {
      const current = state.uploads[attachmentId];
      return {
        uploads: {
          ...state.uploads,
          [attachmentId]: {
            phase: 'failed',
            loaded: current?.loaded ?? 0,
            total: current?.total ?? 0,
            error,
          },
        },
      };
    }),
  clear: attachmentIds =>
    set(state => {
      if (!attachmentIds.some(id => id in state.uploads)) return state;
      const uploads = { ...state.uploads };
      for (const id of attachmentIds) delete uploads[id];
      return { uploads };
    }),
}));
