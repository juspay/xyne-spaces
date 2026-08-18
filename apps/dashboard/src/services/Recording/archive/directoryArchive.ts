import type { RecordingCaptureManifest } from '@xyne/shared';
import {
  MANIFEST_FILE,
  RECORDING_FILE,
  createManifest,
  manifestByteLength,
} from './clientManifest';
import type {
  OpenArchiveCapture,
  RecordingArchiveInit,
  RecordingArchiveKind,
  RecordingArchiveStore,
  RecordingCaptureCreate,
  StoredArchiveCapture,
} from './types';

// Generic archive store over any FileSystemDirectoryHandle root. Both OPFS and the
// web File System Access API expose the identical handle API, so they share this
// implementation; only root acquisition, persistence and free-space differ.

type IterableDirectoryHandle = FileSystemDirectoryHandle & {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
};

function directoryEntries(
  directory: FileSystemDirectoryHandle,
): AsyncIterableIterator<[string, FileSystemHandle]> {
  return (directory as IterableDirectoryHandle).entries();
}

function safeCaptureId(captureId: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(captureId)) throw new Error('Invalid local capture id');
  return captureId;
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotFoundError';
}

async function writeWholeFile(handle: FileSystemFileHandle, contents: string): Promise<void> {
  const writable = await handle.createWritable();
  try {
    await writable.write(contents);
    await writable.close();
  } catch (error) {
    await writable.abort?.().catch(() => undefined);
    throw error;
  }
}

async function readManifest(
  captureDir: FileSystemDirectoryHandle,
): Promise<RecordingCaptureManifest | null> {
  try {
    const handle = await captureDir.getFileHandle(MANIFEST_FILE);
    const text = await (await handle.getFile()).text();
    return JSON.parse(text) as RecordingCaptureManifest;
  } catch {
    return null;
  }
}

/** Serializes appends to a single recording.webm handle (one writable at a time). */
class DirectoryOpenCapture implements OpenArchiveCapture {
  readonly captureId: string;
  private readonly captureDir: FileSystemDirectoryHandle;
  private readonly recording: FileSystemFileHandle;
  private tail: Promise<void> = Promise.resolve();
  private offset: number;

  constructor(
    captureId: string,
    captureDir: FileSystemDirectoryHandle,
    recording: FileSystemFileHandle,
    startOffset: number,
  ) {
    this.captureId = captureId;
    this.captureDir = captureDir;
    this.recording = recording;
    this.offset = startOffset;
  }

  appendFragment(bytes: Blob): Promise<{ byteOffset: number; byteLength: number }> {
    const run = this.tail.then(async () => {
      const byteOffset = this.offset;
      const writable = await this.recording.createWritable({ keepExistingData: true });
      try {
        await writable.seek(byteOffset);
        await writable.write(bytes);
        await writable.close();
      } catch (error) {
        await writable.abort?.().catch(() => undefined);
        throw error;
      }
      this.offset = byteOffset + bytes.size;
      return { byteOffset, byteLength: bytes.size };
    });
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async writeManifest(manifest: RecordingCaptureManifest): Promise<void> {
    const handle = await this.captureDir.getFileHandle(MANIFEST_FILE, { create: true });
    await writeWholeFile(handle, JSON.stringify(manifest));
  }

  async readRange(byteOffset: number, byteLength: number): Promise<Blob> {
    const file = await this.recording.getFile();
    return file.slice(byteOffset, byteOffset + byteLength);
  }

  async finalize(): Promise<void> {
    // The manifest (completed flag) is the source of truth; nothing to move for the
    // in-app directory layout. A user-friendly top-level rename is a later concern.
  }

  async close(): Promise<void> {
    await this.tail.catch(() => undefined);
  }
}

class DirectoryStoredCapture implements StoredArchiveCapture {
  readonly captureId: string;
  readonly manifest: RecordingCaptureManifest;
  private readonly captureDir: FileSystemDirectoryHandle;

  constructor(
    captureId: string,
    manifest: RecordingCaptureManifest,
    captureDir: FileSystemDirectoryHandle,
  ) {
    this.captureId = captureId;
    this.manifest = manifest;
    this.captureDir = captureDir;
  }

  async readRange(byteOffset: number, byteLength: number): Promise<Blob> {
    const handle = await this.captureDir.getFileHandle(RECORDING_FILE);
    const file = await handle.getFile();
    return file.slice(byteOffset, byteOffset + byteLength);
  }

  async writeManifest(manifest: RecordingCaptureManifest): Promise<void> {
    const handle = await this.captureDir.getFileHandle(MANIFEST_FILE, { create: true });
    await writeWholeFile(handle, JSON.stringify(manifest));
  }
}

export class DirectoryArchiveStore implements RecordingArchiveStore {
  readonly kind: RecordingArchiveKind;
  // `prompt` allows a user-gesture directory picker (createCapture); recovery
  // passes false and tolerates a null result (no silent access to prompt for).
  private readonly resolveAppDir: (prompt: boolean) => Promise<FileSystemDirectoryHandle | null>;
  private readonly initFn: () => Promise<RecordingArchiveInit>;
  private readonly freeSpaceFn: () => Promise<{ availableBytes: number | null }>;

  constructor(
    kind: RecordingArchiveKind,
    resolveAppDir: (prompt: boolean) => Promise<FileSystemDirectoryHandle | null>,
    initFn: () => Promise<RecordingArchiveInit>,
    freeSpaceFn: () => Promise<{ availableBytes: number | null }>,
  ) {
    this.kind = kind;
    this.resolveAppDir = resolveAppDir;
    this.initFn = initFn;
    this.freeSpaceFn = freeSpaceFn;
  }

  init(): Promise<RecordingArchiveInit> {
    return this.initFn();
  }

  freeSpace(): Promise<{ availableBytes: number | null }> {
    return this.freeSpaceFn();
  }

  async createCapture(meta: RecordingCaptureCreate): Promise<OpenArchiveCapture> {
    const appDir = await this.resolveAppDir(true);
    if (!appDir) throw new Error('No recording directory was granted');
    const captureDir = await appDir.getDirectoryHandle(safeCaptureId(meta.captureId), {
      create: true,
    });
    const recording = await captureDir.getFileHandle(RECORDING_FILE, { create: true });
    const open = new DirectoryOpenCapture(meta.captureId, captureDir, recording, 0);
    await open.writeManifest(createManifest(meta));
    return open;
  }

  async listPendingCaptures(): Promise<StoredArchiveCapture[]> {
    const appDir = await this.resolveAppDir(false);
    if (!appDir) return [];
    const captures: StoredArchiveCapture[] = [];
    for await (const [name, handle] of directoryEntries(appDir)) {
      if (handle.kind !== 'directory') continue;
      const captureDir = handle as FileSystemDirectoryHandle;
      const manifest = await readManifest(captureDir);
      // One corrupt/incomplete capture must not block recovery of the others.
      if (!manifest || manifest.captureId !== name || !manifest.callId) continue;
      captures.push(new DirectoryStoredCapture(manifest.captureId, manifest, captureDir));
    }
    return captures;
  }

  async deleteCapture(captureId: string): Promise<void> {
    const appDir = await this.resolveAppDir(false);
    if (!appDir) return;
    await appDir.removeEntry(safeCaptureId(captureId), { recursive: true }).catch(error => {
      if (!isNotFoundError(error)) throw error;
    });
  }
}

export { manifestByteLength };
