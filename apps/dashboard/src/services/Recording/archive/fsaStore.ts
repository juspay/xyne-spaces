import { DirectoryArchiveStore } from './directoryArchive';
import { getSavedDirectoryHandle, saveDirectoryHandle } from './directoryHandleStore';
import type { RecordingArchiveInit, RecordingLocationInfo } from './types';

// Web File System Access store: the user picks a real directory (once) and we
// write recording.webm + chunk_manifest.json straight into it, escaping origin
// quota. The directory handle is persisted in IndexedDB and re-permissioned on
// later launches; audio never enters IndexedDB.

const FSA_APP_DIR = 'Xyne Recordings';

function fsaAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

async function ensurePermission(
  handle: FileSystemDirectoryHandle,
  prompt: boolean,
): Promise<boolean> {
  const state = await handle.queryPermission({ mode: 'readwrite' });
  if (state === 'granted') return true;
  if (state === 'denied' || !prompt) return false;
  return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
}

async function resolveRoot(prompt: boolean): Promise<FileSystemDirectoryHandle | null> {
  const saved = await getSavedDirectoryHandle();
  if (saved && (await ensurePermission(saved, prompt))) return saved;
  if (!prompt) return null;
  try {
    const picked = await window.showDirectoryPicker({ id: 'xyne-recordings', mode: 'readwrite' });
    await saveDirectoryHandle(picked);
    return picked;
  } catch {
    return null; // user cancelled the picker
  }
}

async function resolveAppDir(prompt: boolean): Promise<FileSystemDirectoryHandle | null> {
  const root = await resolveRoot(prompt);
  if (!root) return null;
  return root.getDirectoryHandle(FSA_APP_DIR, { create: true });
}

async function describeLocation(): Promise<RecordingLocationInfo> {
  const saved = await getSavedDirectoryHandle();
  return { kind: 'fsa', configured: !!saved, label: saved?.name ?? null, selectable: true };
}

async function chooseLocation(): Promise<RecordingLocationInfo> {
  try {
    const picked = await window.showDirectoryPicker({ id: 'xyne-recordings', mode: 'readwrite' });
    // Grant write access now (within this gesture) so the recorder can start at the
    // very first second of a later call without re-prompting mid-recording.
    await ensurePermission(picked, true);
    await saveDirectoryHandle(picked);
    return { kind: 'fsa', configured: true, label: picked.name, selectable: true };
  } catch {
    return describeLocation(); // user cancelled — keep the current selection
  }
}

export function createFsaStore(): DirectoryArchiveStore | null {
  if (!fsaAvailable()) return null;
  return new DirectoryArchiveStore(
    'fsa',
    resolveAppDir,
    (): Promise<RecordingArchiveInit> => Promise.resolve({ persistent: true, quotaBypassed: true }),
    () => Promise.resolve({ availableBytes: null }),
    describeLocation,
    chooseLocation,
  );
}
