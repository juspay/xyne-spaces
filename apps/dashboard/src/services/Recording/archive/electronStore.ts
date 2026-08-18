import type { RecordingCaptureManifest } from '@xyne/shared';
import type { ElectronAPI, RecordingFsApi } from '../../../types/electron';
import { createManifest } from './clientManifest';
import type {
  OpenArchiveCapture,
  RecordingArchiveInit,
  RecordingArchiveStore,
  RecordingCaptureCreate,
  StoredArchiveCapture,
} from './types';

// Electron native-filesystem store. All file I/O happens in the main process via
// `window.electronAPI.recordingFs` IPC; the renderer only ever holds captureIds
// and never gets an unrestricted filesystem handle.

function recordingFsApi(): RecordingFsApi | null {
  const api = (window as Window & { electronAPI?: ElectronAPI }).electronAPI?.recordingFs;
  return api ?? null;
}

class ElectronOpenCapture implements OpenArchiveCapture {
  readonly captureId: string;
  private readonly api: RecordingFsApi;

  constructor(captureId: string, api: RecordingFsApi) {
    this.captureId = captureId;
    this.api = api;
  }

  async appendFragment(bytes: Blob): Promise<{ byteOffset: number; byteLength: number }> {
    return this.api.appendFragment(this.captureId, await bytes.arrayBuffer());
  }

  async writeManifest(manifest: RecordingCaptureManifest): Promise<void> {
    await this.api.writeManifest(this.captureId, JSON.stringify(manifest));
  }

  async readRange(byteOffset: number, byteLength: number): Promise<Blob> {
    return new Blob([await this.api.readRange(this.captureId, byteOffset, byteLength)]);
  }

  async finalize(): Promise<void> {
    await this.api.finalize(this.captureId);
  }

  async close(): Promise<void> {}
}

class ElectronStoredCapture implements StoredArchiveCapture {
  readonly captureId: string;
  readonly manifest: RecordingCaptureManifest;
  private readonly api: RecordingFsApi;

  constructor(captureId: string, manifest: RecordingCaptureManifest, api: RecordingFsApi) {
    this.captureId = captureId;
    this.manifest = manifest;
    this.api = api;
  }

  async readRange(byteOffset: number, byteLength: number): Promise<Blob> {
    return new Blob([await this.api.readRange(this.captureId, byteOffset, byteLength)]);
  }

  async writeManifest(manifest: RecordingCaptureManifest): Promise<void> {
    await this.api.writeManifest(this.captureId, JSON.stringify(manifest));
  }
}

class ElectronArchiveStore implements RecordingArchiveStore {
  readonly kind = 'electron' as const;
  private readonly api: RecordingFsApi;

  constructor(api: RecordingFsApi) {
    this.api = api;
  }

  init(): Promise<RecordingArchiveInit> {
    return Promise.resolve({ persistent: true, quotaBypassed: true });
  }

  async createCapture(meta: RecordingCaptureCreate): Promise<OpenArchiveCapture> {
    if (!(await this.api.hasDirectory())) {
      const { granted } = await this.api.pickDirectory();
      if (!granted) throw new Error('No recording directory was granted');
    }
    await this.api.createCapture(meta.captureId);
    const open = new ElectronOpenCapture(meta.captureId, this.api);
    await open.writeManifest(createManifest(meta));
    return open;
  }

  async listPendingCaptures(): Promise<StoredArchiveCapture[]> {
    if (!(await this.api.hasDirectory())) return [];
    const rows = await this.api.listPending();
    const captures: StoredArchiveCapture[] = [];
    for (const row of rows) {
      try {
        const manifest = JSON.parse(row.manifestJson) as RecordingCaptureManifest;
        if (manifest.captureId === row.captureId && manifest.callId) {
          captures.push(new ElectronStoredCapture(row.captureId, manifest, this.api));
        }
      } catch {
        // Skip a corrupt manifest; the others still recover.
      }
    }
    return captures;
  }

  async deleteCapture(captureId: string): Promise<void> {
    await this.api.deleteCapture(captureId);
  }

  async freeSpace(): Promise<{ availableBytes: number | null }> {
    return this.api.freeSpace();
  }
}

export function createElectronStore(): RecordingArchiveStore | null {
  const api = recordingFsApi();
  return api ? new ElectronArchiveStore(api) : null;
}
