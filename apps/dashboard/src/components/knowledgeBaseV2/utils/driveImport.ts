import { create } from 'zustand';
import { toast } from 'sonner';
import {
  addDriveLinkToCollection,
  initDriveOAuth,
} from '../../../services/Knowledge/collectionService';
import { useUploadProgress } from '../../../store/useUploadProgressStore';

const IMPORT_LABEL = 'Google Drive import';
const PENDING_KEY = 'kb:driveImport:pending';

export interface PendingDriveImport {
  collectionId: string;
  collectionName: string;
  parentId: string | null;
  link: string;
}

/**
 * Drives the centered "Connect Google Drive" permission dialog. When an import needs
 * Drive access, we open this (a permission ask, not an error toast); the dialog
 * component reads this store and renders it in the middle of the screen.
 */
interface DriveConnectStore {
  isOpen: boolean;
  pending: PendingDriveImport | null;
  open: (pending: PendingDriveImport) => void;
  close: () => void;
}

export const useDriveConnectStore = create<DriveConnectStore>(set => ({
  isOpen: false,
  pending: null,
  open: (pending): void => set({ isOpen: true, pending }),
  close: (): void => set({ isOpen: false, pending: null }),
}));

function newId(): string {
  return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

/** Persist the import to resume after the full-page Drive OAuth redirect. */
export function savePendingDriveImport(pending: PendingDriveImport): void {
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
}

/** Read and clear the pending import (one-shot, consumed on OAuth return). */
export function takePendingDriveImport(): PendingDriveImport | null {
  const raw = sessionStorage.getItem(PENDING_KEY);
  if (!raw) return null;
  sessionStorage.removeItem(PENDING_KEY);
  try {
    return JSON.parse(raw) as PendingDriveImport;
  } catch {
    return null;
  }
}

/**
 * Start the Drive connect flow: stash the pending import, then navigate the current
 * tab to Google's consent screen. The backend returns us to `returnPath` (this KB
 * URL) with `?driveOAuth=success`, where the KB screen resumes the import.
 */
export async function startDriveConnect(pending: PendingDriveImport): Promise<void> {
  savePendingDriveImport(pending);
  const returnPath = `${window.location.pathname}${window.location.search}`;
  try {
    const { authUrl } = await initDriveOAuth(returnPath);
    if (!authUrl) {
      takePendingDriveImport();
      toast.error('Could not start the Google Drive connection.');
      return;
    }
    window.location.href = authUrl;
  } catch (err) {
    takePendingDriveImport();
    toast.error(
      err instanceof Error ? err.message : 'Could not start the Google Drive connection.',
    );
  }
}

/**
 * Run a Drive-link import, mirroring a normal upload: it registers a progress-card
 * entry, calls the backend, then rebuilds the card with the real per-file outcome
 * and toasts a summary. When a private link fails and Drive isn't connected
 * (`needsDriveAuth`), it offers a persistent "Connect Google Drive" action —
 * unless `allowConnect` is false (the post-connect resume, to avoid a loop).
 */
export function runDriveImport(
  pending: PendingDriveImport,
  opts: { allowConnect?: boolean } = {},
): void {
  const { allowConnect = true } = opts;
  const { collectionId, collectionName, parentId, link } = pending;
  const fileId = newId();

  const store = useUploadProgress.getState();
  const { uploadId } = store.startUpload(
    collectionId,
    collectionName,
    [{ file: { name: IMPORT_LABEL } as unknown as File, id: fileId }],
    1,
  );

  const onNeedsAuth = (message: string): void => {
    if (!allowConnect) {
      // Post-connect resume that still can't access the file (e.g. wrong Google
      // account) — surface the error once; don't reopen the dialog (avoid a loop).
      toast.error(`Drive import failed: ${message}`);
      return;
    }
    // Not an error — a permission request. Show the centered "Connect Google Drive"
    // dialog instead of a toast.
    useDriveConnectStore.getState().open(pending);
  };

  void addDriveLinkToCollection(collectionId, link, { parentId })
    .then(result => {
      const s = useUploadProgress.getState();
      const failedAll = result.imported === 0 && result.failed > 0;

      // Rebuild the card with the actual files/counts instead of the placeholder.
      const entries: Array<{
        fileName: string;
        status: 'uploaded' | 'skipped' | 'failed';
        id: string;
      }> = [];
      for (const r of result.results ?? []) {
        entries.push({
          fileName: r.fileName,
          status: r.status === 'skipped' ? 'skipped' : 'uploaded',
          id: newId(),
        });
      }
      for (const e of result.errors ?? []) {
        entries.push({ fileName: e.fileName, status: 'failed', id: newId() });
      }

      if (entries.length > 0) {
        const { uploadId: finalId } = s.startUpload(
          collectionId,
          collectionName,
          entries.map(e => ({ file: { name: e.fileName } as unknown as File, id: e.id })),
          1,
        );
        const s2 = useUploadProgress.getState();
        for (const e of entries) {
          s2.updateFileStatus(finalId, e.fileName, e.id, e.status);
        }
        s2.updateProgress(finalId, entries.length, 1);
        s2.finishUpload(finalId);
      } else {
        s.updateProgress(uploadId, 1, 1);
        s.updateFileStatus(
          uploadId,
          IMPORT_LABEL,
          fileId,
          failedAll ? 'failed' : 'uploaded',
          failedAll ? result.errors?.[0]?.error : undefined,
        );
        s.finishUpload(uploadId);
      }

      const parts = [
        `${String(result.imported)} imported`,
        result.skipped > 0 ? `${String(result.skipped)} skipped` : null,
        result.failed > 0 ? `${String(result.failed)} failed` : null,
      ].filter(Boolean);
      if (result.needsDriveAuth) {
        onNeedsAuth(result.errors?.[0]?.error ?? 'This item may be private.');
      } else if (failedAll) {
        toast.error(`Drive import failed: ${result.errors?.[0]?.error ?? 'Unknown error'}`);
      } else {
        toast.success(`Drive import: ${parts.join(' · ')}`);
      }
    })
    .catch((err: unknown) => {
      // apiClient's response interceptor rethrows a plain Error and hangs the
      // response body off `responseData` (there is no `err.response` here).
      const e = err as {
        message?: string;
        responseData?: { error?: string; needsDriveAuth?: boolean };
      };
      const message = e.responseData?.error ?? e.message ?? 'Import failed.';
      const s = useUploadProgress.getState();
      s.updateFileStatus(uploadId, IMPORT_LABEL, fileId, 'failed', message);
      s.finishUpload(uploadId);
      if (e.responseData?.needsDriveAuth) {
        onNeedsAuth(message);
      } else {
        toast.error(`Drive import failed: ${message}`);
      }
    });
}
