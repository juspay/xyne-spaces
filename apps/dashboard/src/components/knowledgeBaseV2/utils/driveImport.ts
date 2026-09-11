import { create } from 'zustand';
import { toast } from 'sonner';
import {
  addDriveLinkToCollection,
  getDriveImportStatus,
  initDriveOAuth,
  type DriveImportFileStatus,
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

const POLL_INTERVAL_MS = 1200;
const MAX_POLL_ERRORS = 5;

function storeStatusFor(
  s: DriveImportFileStatus,
): 'pending' | 'uploading' | 'uploaded' | 'failed' | 'skipped' {
  if (s === 'uploaded') return 'uploaded';
  if (s === 'skipped') return 'skipped';
  if (s === 'failed') return 'failed';
  return 'uploading';
}

/**
 * Poll the background import's progress and mirror it into the upload card, so the
 * card fills in live (like a normal upload). Stops when the import is done, the card
 * is superseded by another upload, or the status endpoint gives up.
 */
function pollDriveImport(
  collectionId: string,
  sessionId: string,
  liveId: string,
  entries: Array<{ name: string; id: string }>,
  onNeedsAuth: (message: string) => void,
): void {
  let errorCount = 0;

  const tick = async (): Promise<void> => {
    try {
      const p = await getDriveImportStatus(collectionId, sessionId);
      errorCount = 0;
      const s = useUploadProgress.getState();
      // Superseded by another upload → stop (the store only holds one at a time).
      if (s.currentUpload?.id !== liveId) return;

      for (let i = 0; i < p.files.length; i++) {
        const e = entries[i];
        const pf = p.files[i];
        if (!e || !pf) continue;
        s.updateFileStatus(liveId, e.name, e.id, storeStatusFor(pf.status), pf.error);
      }
      s.updateProgress(liveId, p.processed, 1);

      if (!p.done) {
        setTimeout(() => void tick(), POLL_INTERVAL_MS);
        return;
      }

      s.finishUpload(liveId);
      const uploaded = p.files.filter(f => f.status === 'uploaded').length;
      const skipped = p.files.filter(f => f.status === 'skipped').length;
      const failed = p.files.filter(f => f.status === 'failed').length;
      const parts = [
        `${String(uploaded)} imported`,
        skipped > 0 ? `${String(skipped)} skipped` : null,
        failed > 0 ? `${String(failed)} failed` : null,
      ].filter(Boolean);
      if (p.needsDriveAuth) {
        onNeedsAuth('The connected Google Drive access was rejected. Reconnect and try again.');
      } else if (uploaded === 0 && failed > 0) {
        toast.error(`Drive import failed: ${p.files.find(f => f.error)?.error ?? 'Unknown error'}`);
      } else {
        toast.success(`Drive import: ${parts.join(' · ')}`);
      }
    } catch {
      errorCount += 1;
      if (errorCount >= MAX_POLL_ERRORS) {
        const s = useUploadProgress.getState();
        if (s.currentUpload?.id === liveId) s.finishUpload(liveId);
        toast.error('Lost track of the Drive import progress. It may still be running.');
        return;
      }
      setTimeout(() => void tick(), POLL_INTERVAL_MS * 2);
    }
  };

  void tick();
}

/**
 * Run a Drive-link import, mirroring a normal upload. It enqueues the import on the
 * backend (which returns the file list + a session id), registers those files in the
 * upload card, then polls for progress so the card fills in live. When a private link
 * fails and Drive isn't connected (`needsDriveAuth`), it offers a persistent "Connect
 * Google Drive" action — unless `allowConnect` is false (post-connect resume, avoids a loop).
 */
export function runDriveImport(
  pending: PendingDriveImport,
  opts: { allowConnect?: boolean } = {},
): void {
  const { allowConnect = true } = opts;
  const { collectionId, collectionName, parentId, link } = pending;
  const placeholderId = newId();

  // Immediate placeholder card while the backend scans the Drive folder. The real
  // file list isn't known yet, so show a "scanning" phase label instead of the
  // default "Uploading 0 of 1 files" (which reads wrong during this step).
  const store = useUploadProgress.getState();
  const { uploadId } = store.startUpload(
    collectionId,
    collectionName,
    [{ file: { name: IMPORT_LABEL } as unknown as File, id: placeholderId }],
    1,
    'Scanning Google Drive…',
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
    .then(started => {
      const s = useUploadProgress.getState();
      if (!started.sessionId || started.total === 0) {
        s.updateProgress(uploadId, 1, 1);
        s.updateFileStatus(uploadId, IMPORT_LABEL, placeholderId, 'skipped');
        s.finishUpload(uploadId);
        toast.info('Nothing to import from that link.');
        return;
      }

      // Rebuild the card with the real files (all in-progress), then poll live.
      const entries = started.files.map(f => ({ name: f.name, id: newId() }));
      const { uploadId: liveId } = s.startUpload(
        collectionId,
        collectionName,
        entries.map(e => ({ file: { name: e.name } as unknown as File, id: e.id })),
        1,
      );
      const s2 = useUploadProgress.getState();
      for (const e of entries) s2.updateFileStatus(liveId, e.name, e.id, 'uploading');

      pollDriveImport(collectionId, started.sessionId, liveId, entries, onNeedsAuth);
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
      s.updateFileStatus(uploadId, IMPORT_LABEL, placeholderId, 'failed', message);
      s.finishUpload(uploadId);
      if (e.responseData?.needsDriveAuth) {
        onNeedsAuth(message);
      } else {
        toast.error(`Drive import failed: ${message}`);
      }
    });
}
