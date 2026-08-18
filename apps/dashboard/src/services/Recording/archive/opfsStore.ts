import { DirectoryArchiveStore } from './directoryArchive';
import type { RecordingArchiveInit } from './types';

// OPFS fallback. Real files, but inside the browser's origin-private area and
// subject to origin quota (persistence only protects against eviction, not the
// quota ceiling). Used only when neither Electron nor the File System Access API
// is available.

const OPFS_APP_DIR = 'xyne-recording-repairs';

function opfsAvailable(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function';
}

async function opfsAppDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(OPFS_APP_DIR, { create: true });
}

async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist || !navigator.storage.persisted) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}

async function opfsFreeSpace(): Promise<{ availableBytes: number | null }> {
  if (!navigator.storage?.estimate) return { availableBytes: null };
  const { usage, quota } = await navigator.storage.estimate();
  if (usage === undefined || quota === undefined) return { availableBytes: null };
  return { availableBytes: Math.max(0, quota - usage) };
}

export function createOpfsStore(): DirectoryArchiveStore | null {
  if (!opfsAvailable()) return null;
  return new DirectoryArchiveStore(
    'opfs',
    async () => opfsAppDir(),
    async (): Promise<RecordingArchiveInit> => {
      const persistent = await requestPersistence();
      await opfsAppDir();
      return { persistent, quotaBypassed: false };
    },
    opfsFreeSpace,
  );
}
