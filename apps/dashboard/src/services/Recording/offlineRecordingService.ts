import { toast } from 'sonner';
import {
  RECORDING_REPAIR_MERGED_EVENT,
  recordingService,
  type RecordingRepairMergedEventDetail,
  type RecordingRepairOutage,
  type RecordingRepairReason,
  type RecordingRepairStatus,
} from './recordingService';
import { transitionRecordingRepairReasons } from './recordingRepairOutages';

const DATABASE_NAME = 'xyne-recording-repairs';
const CHUNK_STORE = 'chunks';
const CAPTURE_STORE = 'captures';
const CHUNK_DURATION_MS = 10_000;
const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 5 * 60_000;
const FAILED_RETENTION_MS = 7 * 24 * 60 * 60_000;

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
  activeReasons: RecordingRepairReason[];
  activeOutageStartedAt: number | null;
  failedAt?: number;
  failureWarned?: boolean;
}

interface Capture extends PersistedCapture {
  stream: MediaStream;
  mimeType: string;
  recorder: MediaRecorder | null;
  segmentTimer: ReturnType<typeof setTimeout> | null;
  segmentStopped: Promise<void> | null;
  chunkStartedAt: number;
  paused: boolean;
  stopping: boolean;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 3);
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
  private pendingUpload: Promise<void> = Promise.resolve();
  private warnedPersistenceFailure = false;
  private recoveryPromise: Promise<void> | null = null;

  async initialize(): Promise<void> {
    if (typeof window === 'undefined') return;
    if (!('indexedDB' in window)) throw new Error('IndexedDB is unavailable');
    await openDatabase().then(database => database.close());
    this.scheduleRecovery();
  }

  async start(callId: string, track: MediaStreamTrack): Promise<void> {
    if (this.capture?.callId === callId) return;
    if (this.capture) throw new Error('A local recording capture is already active');
    if (typeof MediaRecorder === 'undefined') throw new Error('MediaRecorder is unavailable');
    await this.initialize();

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';
    const capture: Capture = {
      captureId: crypto.randomUUID(),
      callId,
      sequence: 0,
      outages: [],
      activeReasons: [],
      activeOutageStartedAt: null,
      stream: new MediaStream([track]),
      mimeType,
      recorder: null,
      segmentTimer: null,
      segmentStopped: null,
      chunkStartedAt: Date.now(),
      paused: false,
      stopping: false,
    };
    await this.saveCapture(capture);
    this.capture = capture;
    this.startSegment(capture);
  }

  setReason(reason: RecordingRepairReason, active: boolean): void {
    const capture = this.capture;
    if (!capture) return;
    const next = new Set(capture.activeReasons);
    if (active) next.add(reason);
    else next.delete(reason);
    transitionRecordingRepairReasons(capture, [...next], Date.now(), capture.paused);
    this.trackWrite(this.saveCapture(capture));
    if (!active) void this.queueUpload(capture).catch(() => undefined);
  }

  pause(): void {
    const capture = this.capture;
    if (!capture || capture.paused) return;
    const reasons = capture.activeReasons;
    transitionRecordingRepairReasons(capture, [], Date.now(), false);
    capture.activeReasons = reasons;
    capture.paused = true;
    this.clearSegmentTimer(capture);
    if (capture.recorder?.state === 'recording') capture.recorder.stop();
    this.trackWrite(this.saveCapture(capture));
  }

  resume(): void {
    const capture = this.capture;
    if (!capture || !capture.paused || capture.stopping) return;
    capture.paused = false;
    if (capture.activeReasons.length > 0) capture.activeOutageStartedAt = Date.now();
    if (!capture.recorder) this.startSegment(capture);
    this.trackWrite(this.saveCapture(capture));
  }

  async stopAndUpload(): Promise<void> {
    const capture = this.capture;
    if (!capture) return;
    if (capture.activeOutageStartedAt !== null && capture.activeReasons.length > 0) {
      capture.outages.push({
        startedAt: new Date(capture.activeOutageStartedAt).toISOString(),
        endedAt: new Date().toISOString(),
        reasons: capture.activeReasons,
      });
      capture.activeOutageStartedAt = null;
    }
    capture.stopping = true;
    this.clearSegmentTimer(capture);
    const stopped = capture.segmentStopped;
    if (capture.recorder && capture.recorder.state !== 'inactive') capture.recorder.stop();
    this.capture = null;
    if (stopped) await stopped;
    await this.flushWrites();
    await this.saveCapture(capture);

    if (capture.outages.length === 0) {
      await this.deleteLocalCapture(capture.captureId);
      return;
    }
    await this.queueUpload(capture);
    await recordingService.finalizeRecordingRepair(
      capture.callId,
      capture.captureId,
      capture.outages,
    );
    await this.cleanupIfMerged(capture);
  }

  private startSegment(capture: Capture): void {
    if (capture.stopping || capture.paused || this.capture !== capture) return;
    const recorder = new MediaRecorder(capture.stream, { mimeType: capture.mimeType });
    capture.recorder = recorder;
    capture.chunkStartedAt = Date.now();
    let resolveStopped: (() => void) | undefined;
    capture.segmentStopped = new Promise(resolve => {
      resolveStopped = resolve;
    });
    recorder.ondataavailable = (event: BlobEvent): void => {
      if (!event.data.size) return;
      const chunk: StoredChunk = {
        id: `${capture.captureId}:${capture.sequence}`,
        callId: capture.callId,
        captureId: capture.captureId,
        sequence: capture.sequence++,
        startedAt: capture.chunkStartedAt,
        endedAt: Date.now(),
        blob: event.data,
      };
      this.trackWrite(
        Promise.all([this.saveChunk(chunk), this.saveCapture(capture)]).then(() => undefined),
      );
    };
    recorder.onstop = (): void => {
      this.clearSegmentTimer(capture);
      if (capture.recorder === recorder) {
        capture.recorder = null;
        capture.segmentStopped = null;
        if (!capture.stopping && !capture.paused) this.startSegment(capture);
      }
      resolveStopped?.();
    };
    recorder.start();
    capture.segmentTimer = setTimeout(() => {
      capture.segmentTimer = null;
      if (recorder.state === 'recording') recorder.stop();
    }, CHUNK_DURATION_MS);
  }

  private clearSegmentTimer(capture: Capture): void {
    if (capture.segmentTimer === null) return;
    clearTimeout(capture.segmentTimer);
    capture.segmentTimer = null;
  }

  private trackWrite(write: Promise<void>): void {
    const tracked = write.catch(error => {
      if (!this.warnedPersistenceFailure) {
        this.warnedPersistenceFailure = true;
        toast.warning('Local recording protection is unavailable');
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

  private async uploadPending(capture: PersistedCapture): Promise<void> {
    if (!navigator.onLine) return;
    const chunks = (await this.getAll<StoredChunk>(CHUNK_STORE))
      .filter(chunk => chunk.captureId === capture.captureId)
      .sort((left, right) => left.sequence - right.sequence);
    for (const chunk of chunks) {
      if (!this.overlapsOutage(chunk, capture.outages)) continue;
      await recordingService.uploadRecordingRepairChunk(
        capture.callId,
        capture.captureId,
        chunk.sequence,
        {
          audio: chunk.blob,
          startedAt: new Date(chunk.startedAt).toISOString(),
          endedAt: new Date(chunk.endedAt).toISOString(),
          checksum: await checksum(chunk.blob),
          mimeType: chunk.blob.type || 'audio/webm',
        },
      );
    }
  }

  private queueUpload(capture: PersistedCapture): Promise<void> {
    const upload = this.pendingUpload
      .catch(() => undefined)
      .then(() => this.uploadPending(capture));
    this.pendingUpload = upload.catch(() => undefined);
    return upload;
  }

  private scheduleRecovery(): void {
    if (this.recoveryPromise) return;
    this.recoveryPromise = this.recoverPending()
      .catch(() => undefined)
      .finally(() => {
        this.recoveryPromise = null;
      });
  }

  private async recoverPending(): Promise<void> {
    const captures = await this.getAll<PersistedCapture>(CAPTURE_STORE);
    for (const capture of captures) {
      capture.outages ??= [];
      capture.activeReasons ??= [];
      capture.activeOutageStartedAt ??= null;
      if (capture.captureId === this.capture?.captureId) continue;
      if (capture.failedAt && Date.now() - capture.failedAt >= FAILED_RETENTION_MS) {
        await this.deleteLocalCapture(capture.captureId);
        continue;
      }
      if (capture.activeOutageStartedAt !== null && capture.activeReasons.length > 0) {
        capture.outages.push({
          startedAt: new Date(capture.activeOutageStartedAt).toISOString(),
          endedAt: new Date().toISOString(),
          reasons: capture.activeReasons,
        });
        capture.activeOutageStartedAt = null;
        await this.saveCapture(capture);
      }
      if (capture.outages.length === 0) {
        await this.deleteLocalCapture(capture.captureId);
        continue;
      }
      try {
        await this.queueUpload(capture);
        await recordingService.finalizeRecordingRepair(
          capture.callId,
          capture.captureId,
          capture.outages,
        );
        await this.cleanupIfMerged(capture);
      } catch {
        // Preserve durable data for the next online/application initialization.
      }
    }
  }

  private async cleanupIfMerged(capture: PersistedCapture): Promise<void> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (navigator.onLine && Date.now() < deadline) {
      let status: RecordingRepairStatus;
      try {
        status = await recordingService.getRecordingRepairStatus(capture.callId, capture.captureId);
      } catch {
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
        continue;
      }
      if (status.status === 'MERGED') {
        const detail: RecordingRepairMergedEventDetail = {
          callId: capture.callId,
          captureId: capture.captureId,
        };
        window.dispatchEvent(new CustomEvent(RECORDING_REPAIR_MERGED_EVENT, { detail }));
        await this.deleteLocalCapture(capture.captureId);
        return;
      }
      if (status.status === 'FAILED') {
        capture.failedAt ??= Date.now();
        if (!capture.failureWarned) {
          capture.failureWarned = true;
          toast.warning('A recording gap could not be repaired automatically');
        }
        await this.saveCapture(capture);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }

  private async saveChunk(chunk: StoredChunk): Promise<void> {
    await this.transaction(CHUNK_STORE, 'readwrite', store => store.put(chunk));
  }

  private async saveCapture(capture: PersistedCapture): Promise<void> {
    const persisted: PersistedCapture = {
      captureId: capture.captureId,
      callId: capture.callId,
      sequence: capture.sequence,
      outages: capture.outages,
      activeReasons: capture.activeReasons,
      activeOutageStartedAt: capture.activeOutageStartedAt,
      ...(capture.failedAt ? { failedAt: capture.failedAt } : {}),
      ...(capture.failureWarned ? { failureWarned: true } : {}),
    };
    await this.transaction(CAPTURE_STORE, 'readwrite', store => store.put(persisted));
  }

  private async deleteLocalCapture(captureId: string): Promise<void> {
    await this.transaction(CAPTURE_STORE, 'readwrite', store => store.delete(captureId));
    const chunks = await this.getAll<StoredChunk>(CHUNK_STORE);
    await Promise.all(
      chunks
        .filter(chunk => chunk.captureId === captureId)
        .map(chunk => this.transaction(CHUNK_STORE, 'readwrite', store => store.delete(chunk.id))),
    );
  }

  private getAll<T>(storeName: string): Promise<T[]> {
    return this.transaction<T[]>(storeName, 'readonly', store => store.getAll() as IDBRequest<T[]>);
  }

  private async transaction<T>(
    storeName: string,
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
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
    return outages.some(
      outage =>
        chunk.startedAt < new Date(outage.endedAt).getTime() &&
        chunk.endedAt > new Date(outage.startedAt).getTime(),
    );
  }
}

export const offlineRecordingService = new OfflineRecordingService();
