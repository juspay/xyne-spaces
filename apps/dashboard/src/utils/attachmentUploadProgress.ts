export type AttachmentUploadPhase = 'uploading' | 'processing' | 'failed';

export interface AttachmentUploadState {
  phase: AttachmentUploadPhase;
  loaded: number;
  total: number;
  error?: string;
}

export interface AttachmentUploadSummary {
  inProgress: number;
  failed: number;
  loaded: number;
  total: number;
  percent: number;
}

export function uploadPercent(state: Pick<AttachmentUploadState, 'loaded' | 'total'>): number {
  if (state.total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((state.loaded / state.total) * 100)));
}

export function nextUploadPhase(loaded: number, total: number): AttachmentUploadPhase {
  return total > 0 && loaded >= total ? 'processing' : 'uploading';
}

export function summarizeUploads(
  uploads: Record<string, AttachmentUploadState>,
  attachmentIds: readonly string[],
): AttachmentUploadSummary {
  let inProgress = 0;
  let failed = 0;
  let loaded = 0;
  let total = 0;
  for (const id of attachmentIds) {
    const state = uploads[id];
    if (!state) continue;
    if (state.phase === 'failed') {
      failed += 1;
      continue;
    }
    inProgress += 1;
    loaded += state.loaded;
    total += state.total;
  }
  return { inProgress, failed, loaded, total, percent: uploadPercent({ loaded, total }) };
}

export function describeUploadBlock(summary: AttachmentUploadSummary): string | null {
  if (summary.failed > 0) {
    return summary.failed === 1
      ? '1 file failed to upload — retry or remove it'
      : `${summary.failed} files failed to upload — retry or remove them`;
  }
  if (summary.inProgress > 0) {
    const files = summary.inProgress === 1 ? '1 file' : `${summary.inProgress} files`;
    return `Uploading ${files}… ${summary.percent}%`;
  }
  return null;
}

export function formatUploadBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const item = items[next++] as T;
      await worker(item);
    }
  });
  await Promise.all(lanes);
}
