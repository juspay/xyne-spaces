import {
  RECORDING_REPAIR_MERGED_EVENT,
  recordingService,
  type RecordingRepairMergedEventDetail,
  type RecordingRepairOutage,
  type RecordingRepairStatus,
} from './recordingService';
import { toast } from 'sonner';
import { logger, Logger } from '../../utils/logger';

const DATABASE_NAME = 'xyne-recording-repairs';
const CHUNK_STORE = 'chunks';
const CAPTURE_STORE = 'captures';
const CHUNK_DURATION_MS = 10_000;
const REPAIR_STATUS_POLL_INTERVAL_MS = 2_000;
const REPAIR_STATUS_POLL_TIMEOUT_MS = 5 * 60_000;

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
  private pendingUpload: Promise<void> = Promise.resolve();
  private hasPersistenceError = false;

  async initialize(): Promise<void> {
    if (typeof window === 'undefined' || !('indexedDB' in window)) return;
    await this.recoverPending();
  }

  async start(callId: string, track: MediaStreamTrack): Promise<void> {
    if (this.capture) throw new Error('A local recording capture is already active');
    if (typeof MediaRecorder === 'undefined') {
      throw new Error('This browser does not support local recording capture');
    }

    this.hasPersistenceError = false;
    const stream = new MediaStream([track]);
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';
    const capture: Capture = {
      callId,
      captureId: crypto.randomUUID(),
      stream,
      mimeType,
      recorder: null,
      segmentTimer: null,
      segmentStopped: null,
      sequence: 0,
      chunkStartedAt: Date.now(),
      paused: false,
      stopping: false,
      outages: [],
      activeOutage: null,
    };

    await this.saveCapture(capture);
    this.capture = capture;
    this.startSegment(capture);
  }

  enterOutage(reason: RecordingRepairOutage['reason']): void {
    const capture = this.capture;
    if (!capture || capture.activeOutage) return;
    capture.activeOutage = { startedAt: new Date().toISOString(), endedAt: null, reason };
    this.trackWrite(this.saveCapture(capture));
  }

  leaveOutage(expectedReason?: RecordingRepairOutage['reason']): boolean {
    const capture = this.capture;
    if (
      !capture?.activeOutage ||
      (expectedReason && capture.activeOutage.reason !== expectedReason)
    )
      return false;
    capture.activeOutage.endedAt = new Date().toISOString();
    capture.outages.push(capture.activeOutage);
    capture.activeOutage = null;
    this.trackWrite(this.saveCapture(capture));
    void this.queueUpload(capture).catch(() => undefined);
    return true;
  }

  pause(): void {
    const capture = this.capture;
    if (!capture || capture.paused) return;
    capture.paused = true;
    this.clearSegmentTimer(capture);
    if (capture.recorder?.state === 'recording') capture.recorder.stop();
  }

  resume(): void {
    const capture = this.capture;
    if (!capture || !capture.paused || capture.stopping) return;
    capture.paused = false;
    // If stop() is still dispatching its stop event, that handler starts the next
    // segment. Otherwise there is no recorder left and we can start immediately.
    if (!capture.recorder) this.startSegment(capture);
  }

  async stopAndUpload(): Promise<void> {
    const capture = this.capture;
    if (!capture) return;
    this.leaveOutage();
    logger.info(
      Logger.Event.RECORDING_STATE_CHANGED,
      {
        source: 'offline_recording_service',
        event: 'recording_repair_outages_at_stop',
        callId: capture.callId,
        captureId: capture.captureId,
        outageCount: capture.outages.length,
        outages: capture.outages.map((outage, index) => {
          const startedAtMs = new Date(outage.startedAt).getTime();
          const endedAtMs = new Date(outage.endedAt ?? outage.startedAt).getTime();
          return {
            index,
            reason: outage.reason,
            startedAt: outage.startedAt,
            endedAt: outage.endedAt,
            startedAtMs,
            endedAtMs,
            durationMs: Math.max(0, endedAtMs - startedAtMs),
          };
        }),
      },
      true,
    );
    capture.stopping = true;
    this.clearSegmentTimer(capture);
    const segmentStopped = capture.segmentStopped;
    if (capture.recorder?.state === 'recording' || capture.recorder?.state === 'paused') {
      capture.recorder.stop();
    }
    // Detach synchronously so repair upload/status polling for this recording
    // cannot block a new recording from starting with its own active capture.
    this.capture = null;
    if (segmentStopped) await segmentStopped;
    await this.flushWrites();
    if (capture.outages.length) {
      await this.queueUpload(capture);
      await recordingService.finalizeRecordingRepair(
        capture.callId,
        capture.captureId,
        capture.outages,
      );
      await this.cleanupIfMerged(capture);
    } else {
      await this.deleteCapture(capture.captureId);
      await this.deleteChunks(capture.captureId);
    }
  }

  /**
   * A MediaRecorder timeslice is only a fragment of one WebM stream. In
   * particular, blobs after the first usually have no EBML/track header and
   * cannot be sent to a transcription API independently. Use one recorder
   * lifecycle per segment so every persisted blob is a complete WebM file.
   */
  private startSegment(capture: Capture): void {
    if (capture.stopping || capture.paused || this.capture !== capture) return;

    const recorder = new MediaRecorder(capture.stream, { mimeType: capture.mimeType });
    capture.recorder = recorder;
    capture.chunkStartedAt = Date.now();

    let resolveStopped: (() => void) | undefined;
    capture.segmentStopped = new Promise<void>(resolve => {
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
      // Ignore a stale stop event if another segment was already installed.
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
    const persisted: PersistedCapture = {
      captureId: capture.captureId,
      callId: capture.callId,
      sequence: capture.sequence,
      outages: capture.outages,
      activeOutage: capture.activeOutage,
    };
    await this.transaction(CAPTURE_STORE, 'readwrite', store => store.put(persisted));
  }

  private async uploadPending(capture: PersistedCapture): Promise<void> {
    if (!navigator.onLine) return;
    const chunks = (await this.getAll<StoredChunk>(CHUNK_STORE))
      .filter(chunk => chunk.captureId === capture.captureId)
      .sort((left, right) => left.sequence - right.sequence);
    const selectedSequences = new Set<number>();
    for (const chunk of chunks) {
      if (!this.overlapsOutage(chunk, capture.outages)) continue;
      selectedSequences.add(chunk.sequence);
      if (chunk.sequence > 0) selectedSequences.add(chunk.sequence - 1);
    }

    for (const chunk of chunks) {
      if (!selectedSequences.has(chunk.sequence)) continue;
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

  /** Serialize uploads so leaveOutage, stop, and browser-online recovery cannot race finalization. */
  private queueUpload(capture: PersistedCapture): Promise<void> {
    const upload = this.pendingUpload
      .catch(() => undefined)
      .then(() => this.uploadPending(capture));
    this.pendingUpload = upload.catch(() => undefined);
    return upload;
  }

  // Recovery closes an interrupted outage, then retries upload and finalization.
  private async recoverPending(): Promise<void> {
    const captures = await this.getAll<PersistedCapture>(CAPTURE_STORE);
    for (const capture of captures) {
      // Initialization also runs on browser-online and when the recording page
      // remounts. Never recover/finalize the capture that is still recording.
      if (capture.captureId === this.capture?.captureId) continue;
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
        await this.queueUpload(recovered);
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
    const deadline = Date.now() + REPAIR_STATUS_POLL_TIMEOUT_MS;

    while (navigator.onLine) {
      let status: RecordingRepairStatus;
      try {
        status = await recordingService.getRecordingRepairStatus(capture.callId, capture.captureId);
      } catch {
        // A transient status request must not discard the locally persisted
        // capture. Keep polling while online and let later initialization retry
        // if this window expires.
        if (Date.now() >= deadline) return;
        await new Promise(resolve => setTimeout(resolve, REPAIR_STATUS_POLL_INTERVAL_MS));
        continue;
      }
      if (status.status === 'MERGED') {
        const detail: RecordingRepairMergedEventDetail = {
          callId: capture.callId,
          captureId: capture.captureId,
        };
        window.dispatchEvent(new CustomEvent(RECORDING_REPAIR_MERGED_EVENT, { detail }));
        await this.deleteCapture(capture.captureId);
        await this.deleteChunks(capture.captureId);
        return;
      }

      if (Date.now() >= deadline) return;
      await new Promise(resolve => setTimeout(resolve, REPAIR_STATUS_POLL_INTERVAL_MS));
    }
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
