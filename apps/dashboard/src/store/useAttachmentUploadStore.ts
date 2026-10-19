import { useMemo } from 'react';
import { create } from 'zustand';

/**
 * Byte progress for in-flight chat attachment uploads.
 *
 * Deliberately separate from `useUploadProgress` (knowledge base): that store holds exactly
 * one task at a time, while a user can have attachments uploading in several channels at
 * once — each needing its own click-through target.
 *
 * This lives at module scope rather than in the composer because an upload now outlives the
 * send: the message posts immediately and the bytes keep streaming while the user navigates
 * away. Progress exists only in this browser (the DB tracks PENDING/FAILED, never a
 * percentage), so the pill reads from here while the attachment tiles read `uploadStatus`
 * off the Zero row.
 */
export interface AttachmentUploadBatch {
  /** Id of the batched POST, not of any one attachment. */
  batchId: string;
  attachmentIds: string[];
  fileNames: string[];
  /** Where the pill routes on click. */
  channelId: string;
  conversationId: string | null;
  /**
   * Captured when the upload starts, not read at click time: `useRouteContext` derives the
   * base route from the *current* pathname, so a user who wanders into a DM would otherwise
   * get `/chat/dm/<a dir channel id>`. At attach time they are by definition in the right chat.
   */
  baseRoute: string;
  totalBytes: number;
  loadedBytes: number;
  startedAt: number;
  /**
   * A failed batch is kept rather than dropped: the pill is the only global signal that an
   * upload died, and the user may be in another channel when it happens. It leaves on a
   * retry or an explicit dismiss.
   */
  status: 'uploading' | 'failed';
}

interface AttachmentUploadState {
  batches: Record<string, AttachmentUploadBatch>;
  startBatch: (batch: Omit<AttachmentUploadBatch, 'loadedBytes' | 'startedAt' | 'status'>) => void;
  setProgress: (batchId: string, loadedBytes: number, totalBytes?: number) => void;
  failBatch: (batchId: string) => void;
  /** Back to zero for a retry of the same batch. */
  restartBatch: (batchId: string) => void;
  endBatch: (batchId: string) => void;
}

export const useAttachmentUpload = create<AttachmentUploadState>((set, get) => ({
  batches: {},

  startBatch: batch =>
    set(state => ({
      batches: {
        ...state.batches,
        [batch.batchId]: { ...batch, loadedBytes: 0, startedAt: Date.now(), status: 'uploading' },
      },
    })),

  failBatch: batchId =>
    set(state => {
      const batch = state.batches[batchId];
      if (!batch) return state;
      return { batches: { ...state.batches, [batchId]: { ...batch, status: 'failed' } } };
    }),

  restartBatch: batchId =>
    set(state => {
      const batch = state.batches[batchId];
      if (!batch) return state;
      return {
        batches: {
          ...state.batches,
          [batchId]: { ...batch, status: 'uploading', loadedBytes: 0, startedAt: Date.now() },
        },
      };
    }),

  setProgress: (batchId, loadedBytes, totalBytes) =>
    set(state => {
      const batch = state.batches[batchId];
      if (!batch) return state;
      // A 401 mid-upload makes the api client replay the whole request (apiClient.ts), which
      // restarts onUploadProgress from zero. Clamping keeps the pill from running backwards.
      const nextLoaded = Math.max(batch.loadedBytes, loadedBytes);
      if (nextLoaded === batch.loadedBytes && !totalBytes) return state;
      return {
        batches: {
          ...state.batches,
          [batchId]: {
            ...batch,
            loadedBytes: nextLoaded,
            totalBytes: totalBytes ?? batch.totalBytes,
          },
        },
      };
    }),

  endBatch: batchId => {
    if (!get().batches[batchId]) return;
    set(state => {
      const { [batchId]: _removed, ...rest } = state.batches;
      return { batches: rest };
    });
  },
}));

/**
 * Ids with bytes still in flight, for the composer chips.
 *
 * Selects a joined string rather than a Set so zustand can bail out by value: the result
 * changes only when a batch starts or ends, never on a progress tick, which keeps the
 * composer from re-rendering dozens of times a second while a large file uploads.
 */
export function useUploadingAttachmentIds(): Set<string> {
  const key = useAttachmentUpload(s =>
    Object.values(s.batches)
      .filter(b => b.status === 'uploading')
      .flatMap(b => b.attachmentIds)
      .sort()
      .join(','),
  );
  return useMemo(() => new Set(key ? key.split(',') : []), [key]);
}

/** Percentage for one batch, capped at 99 until the request actually resolves. */
export function batchPercent(batch: AttachmentUploadBatch): number {
  if (batch.totalBytes <= 0) return 0;
  const pct = Math.round((batch.loadedBytes / batch.totalBytes) * 100);
  // The last byte reaching the server is not the upload being done: the backend still has to
  // stream it to storage and write the row. Holding at 99 avoids a pill that sits at 100%.
  return Math.min(pct, 99);
}

/**
 * Route back to the chat an upload belongs to.
 *
 * Uses the base route captured when the upload started, not the current location. Written
 * without the workspace segment: react-router-dom is aliased to a workspace-aware shim that
 * prefixes it.
 */
export function batchRoute(batch: AttachmentUploadBatch): string {
  return batch.conversationId
    ? `${batch.baseRoute}/${batch.channelId}/${batch.conversationId}`
    : `${batch.baseRoute}/${batch.channelId}`;
}

/** Label for the pill: the single file's name, or a count once there is more than one. */
export function batchLabel(batch: AttachmentUploadBatch): string {
  const [first] = batch.fileNames;
  if (batch.fileNames.length === 1 && first) return first;
  return `${batch.fileNames.length} files`;
}
