import { recordingService, type RecordingRepairOutage } from './recordingService';
import { toast } from 'sonner';

const DATABASE_NAME = 'xyne-recording-repairs';
const CHUNK_STORE = 'chunks';
const CAPTURE_STORE = 'captures';
const CHUNK_DURATION_MS = 5_000;

interface StoredChunk {
  id: string;
  callId: string;
  captureId: string;
  sequence: number;
  startedAt: number;
  endedAt: number;
  blob: Blob;
}

interface PersistedCapture {
  captureId: string;
  callId: string;
  sequence: number;
  outages: RecordingRepairOutage[];
  activeOutage: RecordingRepairOutage | null;
}

interface Capture extends PersistedCapture {
  recorder: MediaRecorder;
  chunkStartedAt: number;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 2);
    request.onupgradeneeded = (): void => {
      const database = request.result;
      if (!database.objectStoreNames.contains(CHUNK_STORE)) {
        database.createObjectStore(CHUNK_STORE, { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains(CAPTURE_STORE)) {
        database.createObjectStore(CAPTURE_STORE, { keyPath: 'captureId' });
      }
    };
    request.onsuccess = (): void => resolve(request.result);
    request.onerror = (): void => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

async function checksum(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export class OfflineRecordingService {
  private capture: Capture | null = null;
  private pendingWrites = new Set<Promise<void>>();
  private hasPersistenceError = false;

  async initialize(): Promise<void> {
    if (typeof window === 'undefined' || !('indexedDB' in window)) return;
    await this.recoverPending();
  }

  async start(callId: string, track: MediaStreamTrack): Promise<void> {
    if (this.capture || typeof MediaRecorder === 'undefined') return;

    this.hasPersistenceError = false;
    const stream = new MediaStream([track]);
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';
    const recorder = new MediaRecorder(stream, { mimeType });
    const capture: Capture = {
      callId,
      captureId: crypto.randomUUID(),
      recorder,
      sequence: 0,
      chunkStartedAt: Date.now(),
      outages: [],
      activeOutage: null,
    };

    recorder.ondataavailable = (event: BlobEvent): void => {
      if (!event.data.size) return;
      const startedAt = capture.chunkStartedAt;
      const endedAt = Date.now();
      capture.chunkStartedAt = endedAt;
      const chunk: StoredChunk = {
        id: `${capture.captureId}:${capture.sequence}`,
        callId: capture.callId,
        captureId: capture.captureId,
        sequence: capture.sequence++,
        startedAt,
        endedAt,
        blob: event.data,
      };
      this.trackWrite(Promise.all([this.saveChunk(chunk), this.saveCapture(capture)]).then(() => undefined));
    };

    await this.saveCapture(capture);
    recorder.start(CHUNK_DURATION_MS);
    this.capture = capture;
  }

  enterOutage(reason: RecordingRepairOutage['reason']): void {
    const capture = this.capture;
    if (!capture || capture.activeOutage) return;
    capture.activeOutage = { startedAt: new Date().toISOString(), endedAt: null, reason };
    this.trackWrite(this.saveCapture(capture));
  }

  leaveOutage(): void {
    const capture = this.capture;
    if (!capture?.activeOutage) return;
    capture.activeOutage.endedAt = new Date().toISOString();
    capture.outages.push(capture.activeOutage);
    capture.activeOutage = null;
    this.trackWrite(this.saveCapture(capture));
    void this.uploadPending(capture).catch(() => undefined);
  }

  pause(): void {
    if (this.capture?.recorder.state === 'recording') this.capture.recorder.pause();
  }

  resume(): void {
    if (this.capture?.recorder.state === 'paused') this.capture.recorder.resume();
  }

  async stopAndUpload(): Promise<void> {
    const capture = this.capture;
    if (!capture) return;
    this.leaveOutage();
    if (capture.recorder.state !== 'inactive') {
      await new Promise<void>(resolve => {
        capture.recorder.addEventListener('stop', () => resolve(), { once: true });
        capture.recorder.stop();
      });
    }
    await this.flushWrites();
    if (capture.outages.length) {
      await this.uploadPending(capture);
      await recordingService.finalizeRecordingRepair(capture.callId, capture.captureId, capture.outages);
      await this.cleanupIfMerged(capture);
    }
    this.capture = null;
  }

  private trackWrite(write: Promise<void>): void {
    const tracked = write.catch(error => {
      if (!this.hasPersistenceError) {
        this.hasPersistenceError = true;
        toast.error('Offline recording could not be saved locally', {
          description: 'Keep this tab open and restore network before stopping.',
        });
      }
      throw error;
    });
    this.pendingWrites.add(tracked);
    void tracked.then(
      () => this.pendingWrites.delete(tracked),
      () => this.pendingWrites.delete(tracked),
    );
  }

  private async flushWrites(): Promise<void> {
    await Promise.all([...this.pendingWrites]);
  }

  private async saveChunk(chunk: StoredChunk): Promise<void> {
    await this.transaction(CHUNK_STORE, 'readwrite', store => store.put(chunk));
  }

  private async saveCapture(capture: PersistedCapture): Promise<void> {
    const { recorder: _recorder, chunkStartedAt: _chunkStartedAt, ...persisted } = capture as Capture;
    await this.transaction(CAPTURE_STORE, 'readwrite', store => store.put(persisted));
  }

  private async uploadPending(capture: PersistedCapture): Promise<void> {
    if (!navigator.onLine) return;
    const chunks = await this.getAll<StoredChunk>(CHUNK_STORE);
    for (const chunk of chunks) {
      if (chunk.captureId !== capture.captureId || !this.overlapsOutage(chunk, capture.outages)) continue;
      await recordingService.uploadRecordingRepairChunk(capture.callId, capture.captureId, chunk.sequence, {
        audio: chunk.blob,
        startedAt: new Date(chunk.startedAt).toISOString(),
        endedAt: new Date(chunk.endedAt).toISOString(),
        checksum: await checksum(chunk.blob),
        mimeType: chunk.blob.type || 'audio/webm',
      });
    }
  }

  // Recovery closes an interrupted outage, then retries upload and finalization.
  private async recoverPending(): Promise<void> {
    const captures = await this.getAll<PersistedCapture>(CAPTURE_STORE);
    for (const capture of captures) {
      const outages = capture.activeOutage
        ? [...capture.outages, { ...capture.activeOutage, endedAt: new Date().toISOString() }]
        : capture.outages;
      if (!outages.length) {
        await this.deleteCapture(capture.captureId);
        await this.deleteChunks(capture.captureId);
        continue;
      }
      try {
        const recovered = { ...capture, outages, activeOutage: null };
        if (capture.activeOutage) await this.saveCapture(recovered);
        await this.uploadPending(recovered);
        await recordingService.finalizeRecordingRepair(capture.callId, capture.captureId, outages);
        await this.cleanupIfMerged(recovered);
      } catch {
        // Keep capture in IndexedDB; browser-online or next initialization retries it.
      }
    }
  }

  private async deleteCapture(captureId: string): Promise<void> {
    await this.transaction(CAPTURE_STORE, 'readwrite', store => store.delete(captureId));
  }

  private async cleanupIfMerged(capture: PersistedCapture): Promise<void> {
    const status = await recordingService.getRecordingRepairStatus(capture.callId, capture.captureId);
    if (status.status !== 'MERGED') return;
    await this.deleteCapture(capture.captureId);
    await this.deleteChunks(capture.captureId);
  }

  private async deleteChunks(captureId: string): Promise<void> {
    const chunks = await this.getAll<StoredChunk>(CHUNK_STORE);
    await Promise.all(
      chunks
        .filter(chunk => chunk.captureId === captureId)
        .map(chunk => this.transaction(CHUNK_STORE, 'readwrite', store => store.delete(chunk.id))),
    );
  }

  private async getAll<T>(storeName: string): Promise<T[]> {
    return this.transaction<T[]>(storeName, 'readonly', store => store.getAll() as IDBRequest<T[]>);
  }

  private async transaction<T>(
    storeName: string,
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const database = await openDatabase();
    return new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      const request = operation(transaction.objectStore(storeName));
      request.onsuccess = (): void => resolve(request.result);
      request.onerror = (): void => reject(request.error ?? new Error('IndexedDB request failed'));
      transaction.oncomplete = (): void => database.close();
      transaction.onerror = (): void => {
        database.close();
        reject(transaction.error ?? new Error('IndexedDB transaction failed'));
      };
    });
  }

  private overlapsOutage(chunk: StoredChunk, outages: RecordingRepairOutage[]): boolean {
    return outages.some(outage => {
      const outageStart = new Date(outage.startedAt).getTime();
      const outageEnd = outage.endedAt ? new Date(outage.endedAt).getTime() : Date.now();
      return chunk.startedAt < outageEnd && chunk.endedAt > outageStart;
    });
  }
}

export const offlineRecordingService = new OfflineRecordingService();
