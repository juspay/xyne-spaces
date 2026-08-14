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
const ROLLING_BUFFER_DURATION_MS = 20_000;
// Match livekit-client 2.17's default mono AudioPresets.music publish ceiling.
const FALLBACK_AUDIO_BITS_PER_SECOND = 48_000;
const STORAGE_ESTIMATE_INTERVAL_MS = 60_000;
const STORAGE_LOW_REMAINING_MS = 2 * 60 * 60_000;
const POLL_INTERVAL_MS = 2_000;
const FAILED_RETENTION_MS = 7 * 24 * 60 * 60_000;
export const RECORDING_STORAGE_EXHAUSTED_EVENT = 'xyne-recording-storage-exhausted';

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
  lastDurableChunkEndedAt?: number;
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
  rollingChunks: StoredChunk[];
  persistenceActive: boolean;
  trackId: string;
  switchingTrack: boolean;
  trackSwitchPromise: Promise<void> | null;
}

function isQuotaExceededError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'QuotaExceededError'
  );
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 4);
    request.onupgradeneeded = (): void => {
      const database = request.result;
      if (!database.objectStoreNames.contains(CHUNK_STORE)) {
        const chunks = database.createObjectStore(CHUNK_STORE, { keyPath: 'id' });
        chunks.createIndex('captureId', 'captureId', { unique: false });
      } else {
        const chunks = request.transaction?.objectStore(CHUNK_STORE);
        if (chunks && !chunks.indexNames.contains('captureId')) {
          chunks.createIndex('captureId', 'captureId', { unique: false });
        }
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
  private writeFailures = new Set<unknown>();
  private pendingUpload: Promise<void> = Promise.resolve();
  private warnedPersistenceFailure = false;
  private recoveryPromise: Promise<void> | null = null;
  private statusPolls = new Map<string, Promise<void>>();
  private storageReclaimPromise: Promise<void> | null = null;
  private startingCallId: string | null = null;
  private startPromise: Promise<void> | null = null;
  private lastStorageEstimateAt = 0;
  private warnedLowStorage = false;
  private warnedStorageFull = false;
  private storageExhausted = false;
  private recentChunkRates: Array<{ bytes: number; durationMs: number }> = [];

  async initialize(): Promise<void> {
    if (typeof window === 'undefined') return;
    if (!('indexedDB' in window)) throw new Error('IndexedDB is unavailable');
    await openDatabase().then(database => database.close());
    this.scheduleRecovery();
  }

  async start(callId: string, track: MediaStreamTrack): Promise<void> {
    if (this.capture?.callId === callId) {
      if (this.capture.trackId !== track.id) await this.replaceTrack(this.capture, track);
      return;
    }
    if (this.capture) throw new Error('A local recording capture is already active');
    if (this.startPromise) {
      if (this.startingCallId !== callId) {
        throw new Error('A local recording capture is already starting');
      }
      await this.startPromise;
      return this.start(callId, track);
    }
    if (typeof MediaRecorder === 'undefined') throw new Error('MediaRecorder is unavailable');

    this.startingCallId = callId;
    this.startPromise = this.startCapture(callId, track).finally(() => {
      this.startPromise = null;
      this.startingCallId = null;
    });
    return this.startPromise;
  }

  /** Best effort for a normal page close; hard crashes recover to the last durable chunk. */
  prepareForPageHide(): void {
    const capture = this.capture;
    if (!capture) return;
    this.clearSegmentTimer(capture);
    if (capture.recorder?.state === 'recording') capture.recorder.stop();
  }

  private async startCapture(callId: string, track: MediaStreamTrack): Promise<void> {
    await this.initialize();

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : null;
    if (!mimeType) throw new Error('WebM audio recording is unavailable in this browser');
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
      rollingChunks: [],
      persistenceActive: false,
      trackId: track.id,
      switchingTrack: false,
      trackSwitchPromise: null,
    };
    this.capture = capture;
    this.warnedPersistenceFailure = false;
    this.writeFailures.clear();
    this.warnedLowStorage = false;
    this.warnedStorageFull = false;
    this.storageExhausted = false;
    this.lastStorageEstimateAt = 0;
    this.recentChunkRates = [];
    this.startSegment(capture);
    void this.monitorStorage(capture, true);
  }

  setReason(reason: RecordingRepairReason, active: boolean, occurredAt = Date.now()): void {
    const capture = this.capture;
    if (!capture) return;
    const next = new Set(capture.activeReasons);
    if (active) next.add(reason);
    else next.delete(reason);
    transitionRecordingRepairReasons(capture, [...next], occurredAt, capture.paused);
    if (active) {
      capture.persistenceActive = true;
      const rollingChunks = capture.rollingChunks.filter(chunk => chunk.endedAt > occurredAt);
      this.trackWrite(this.persistChunksWithRecovery(rollingChunks, capture));
      void this.monitorStorage(capture, true);
    } else if (capture.persistenceActive) {
      this.trackWrite(this.saveCapture(capture));
    }
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
    if (capture.persistenceActive) this.trackWrite(this.saveCapture(capture));
  }

  resume(): void {
    const capture = this.capture;
    if (!capture || !capture.paused || capture.stopping) return;
    capture.paused = false;
    if (capture.activeReasons.length > 0) capture.activeOutageStartedAt = Date.now();
    if (!capture.recorder) this.startSegment(capture);
    if (capture.persistenceActive) this.trackWrite(this.saveCapture(capture));
  }

  async stopAndUpload(): Promise<void> {
    if (this.startPromise) {
      try {
        await this.startPromise;
      } catch {
        return;
      }
    }
    const capture = this.capture;
    if (!capture) return;
    if (capture.trackSwitchPromise) await capture.trackSwitchPromise;
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
    if (capture.persistenceActive) await this.saveCapture(capture);

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
    this.scheduleCleanupIfMerged(capture);
  }

  private startSegment(capture: Capture): void {
    if (capture.stopping || capture.paused || this.capture !== capture) return;
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(capture.stream, {
        mimeType: capture.mimeType,
        audioBitsPerSecond: FALLBACK_AUDIO_BITS_PER_SECOND,
      });
    } catch (error) {
      if (this.capture === capture) this.capture = null;
      throw error;
    }
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
      const overlapsKnownOutage =
        this.overlapsOutage(chunk, capture.outages) ||
        (capture.activeOutageStartedAt !== null && chunk.endedAt > capture.activeOutageStartedAt);
      if (capture.persistenceActive && overlapsKnownOutage) {
        const write = this.persistChunkWithRecovery(chunk, capture);
        this.trackWrite(write);
        void write.then(() => this.monitorStorage(capture)).catch(() => undefined);
      }
      this.recordChunkRate(chunk);
      void this.monitorStorage(capture);
      capture.rollingChunks.push(chunk);
      const retainAfter = chunk.endedAt - ROLLING_BUFFER_DURATION_MS;
      capture.rollingChunks = capture.rollingChunks.filter(item => item.endedAt > retainAfter);
    };
    recorder.onstop = (): void => {
      this.clearSegmentTimer(capture);
      if (capture.recorder === recorder) {
        capture.recorder = null;
        capture.segmentStopped = null;
        if (!capture.stopping && !capture.paused && !capture.switchingTrack) {
          try {
            this.startSegment(capture);
          } catch {
            toast.warning('Local recording protection stopped unexpectedly');
          }
        }
      }
      resolveStopped?.();
    };
    recorder.onerror = (): void => {
      this.clearSegmentTimer(capture);
      if (capture.recorder === recorder) {
        capture.recorder = null;
        capture.segmentStopped = null;
      }
      resolveStopped?.();
      if (this.capture === capture) this.capture = null;
      toast.warning('Local recording protection stopped unexpectedly');
    };
    try {
      recorder.start();
    } catch (error) {
      capture.recorder = null;
      capture.segmentStopped = null;
      if (this.capture === capture) this.capture = null;
      resolveStopped?.();
      throw error;
    }
    capture.segmentTimer = setTimeout(() => {
      capture.segmentTimer = null;
      if (recorder.state === 'recording') recorder.stop();
    }, CHUNK_DURATION_MS);
  }

  private replaceTrack(capture: Capture, track: MediaStreamTrack): Promise<void> {
    if (capture.trackId === track.id) return Promise.resolve();
    if (capture.trackSwitchPromise) {
      return capture.trackSwitchPromise.then(() => this.replaceTrack(capture, track));
    }
    capture.switchingTrack = true;
    capture.trackSwitchPromise = (async (): Promise<void> => {
      this.clearSegmentTimer(capture);
      const stopped = capture.segmentStopped;
      if (capture.recorder?.state === 'recording') capture.recorder.stop();
      if (stopped) await stopped;
      capture.stream = new MediaStream([track]);
      capture.trackId = track.id;
      capture.switchingTrack = false;
      if (!capture.stopping && !capture.paused && this.capture === capture) {
        this.startSegment(capture);
      }
    })().finally(() => {
      capture.switchingTrack = false;
      capture.trackSwitchPromise = null;
    });
    return capture.trackSwitchPromise;
  }

  private clearSegmentTimer(capture: Capture): void {
    if (capture.segmentTimer === null) return;
    clearTimeout(capture.segmentTimer);
    capture.segmentTimer = null;
  }

  private trackWrite(write: Promise<void>): void {
    const tracked = write.catch(error => {
      this.writeFailures.add(error);
      if (isQuotaExceededError(error)) {
        this.warnStorageFull();
      } else if (!this.warnedPersistenceFailure) {
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
    if (this.writeFailures.size > 0) {
      throw new Error('One or more local recording writes failed');
    }
  }

  private async persistChunkWithRecovery(chunk: StoredChunk, capture: Capture): Promise<void> {
    return this.persistChunksWithRecovery([chunk], capture);
  }

  private async persistChunksWithRecovery(chunks: StoredChunk[], capture: Capture): Promise<void> {
    const persist = (): Promise<void> => this.saveChunksAndCapture(chunks, capture);
    try {
      await persist();
    } catch (error) {
      if (!isQuotaExceededError(error)) throw error;
      this.warnStorageFull();
      await this.reclaimLocalStorage(capture);
      // Retrying the same idempotent puts preserves the failed chunk when
      // acknowledged uploads or disposable captures freed enough space.
      try {
        await persist();
      } catch (retryError) {
        if (isQuotaExceededError(retryError)) {
          this.stopForStorageExhaustion(capture);
        }
        throw retryError;
      }
    }
  }

  private stopForStorageExhaustion(capture: Capture): void {
    if (this.storageExhausted) return;
    this.storageExhausted = true;
    capture.stopping = true;
    this.clearSegmentTimer(capture);
    if (capture.recorder?.state === 'recording') capture.recorder.stop();
    toast.error('Recording stopped because local storage is full', {
      description: 'Protected audio could no longer be saved safely.',
      duration: Infinity,
      closeButton: true,
    });
    window.dispatchEvent(new Event(RECORDING_STORAGE_EXHAUSTED_EVENT));
  }

  private recordChunkRate(chunk: StoredChunk): void {
    const durationMs = chunk.endedAt - chunk.startedAt;
    if (durationMs <= 0) return;
    this.recentChunkRates.push({ bytes: chunk.blob.size, durationMs });
    this.recentChunkRates = this.recentChunkRates.slice(-6);
  }

  private async monitorStorage(capture: Capture, force = false): Promise<void> {
    if (!navigator.storage?.estimate) return;
    const now = Date.now();
    if (!force && now - this.lastStorageEstimateAt < STORAGE_ESTIMATE_INTERVAL_MS) return;
    this.lastStorageEstimateAt = now;

    try {
      const { usage, quota } = await navigator.storage.estimate();
      if (usage === undefined || quota === undefined || quota <= 0) return;
      const available = Math.max(0, quota - usage);
      const measuredBytes = this.recentChunkRates.reduce((total, item) => total + item.bytes, 0);
      const measuredDurationMs = this.recentChunkRates.reduce(
        (total, item) => total + item.durationMs,
        0,
      );
      const bytesPerMs =
        measuredDurationMs > 0
          ? measuredBytes / measuredDurationMs
          : FALLBACK_AUDIO_BITS_PER_SECOND / 8 / 1000;
      const remainingMs = bytesPerMs > 0 ? available / bytesPerMs : Number.POSITIVE_INFINITY;
      const low = remainingMs <= STORAGE_LOW_REMAINING_MS;
      if (!low) return;

      if (!this.warnedLowStorage) {
        this.warnedLowStorage = true;
        const remainingMinutes = Math.max(1, Math.floor(remainingMs / 60_000));
        toast.warning('Local recording storage is running low', {
          description: `Approximately ${remainingMinutes} minutes of fallback audio capacity remains.`,
        });
      }
      void this.reclaimLocalStorage(capture);
    } catch {
      // Storage estimates are advisory. A failed estimate must not interrupt capture;
      // IndexedDB writes remain the authoritative signal for quota exhaustion.
    }
  }

  private warnStorageFull(): void {
    if (this.warnedStorageFull) return;
    this.warnedStorageFull = true;
    toast.warning('Local recording storage is full', {
      description: 'Trying to upload protected audio and reclaim safe local storage.',
    });
  }

  private reclaimLocalStorage(capture: PersistedCapture): Promise<void> {
    if (this.storageReclaimPromise) return this.storageReclaimPromise;
    this.storageReclaimPromise = (async (): Promise<void> => {
      if (navigator.onLine) {
        try {
          await this.uploadPending(capture, true);
        } catch {
          // The backend may be unreachable even while navigator.onLine is true.
          // Safe local cleanup below may still recover enough space.
        }
      }
      await this.cleanupDisposableLocalData(capture.captureId);
    })().finally(() => {
      this.storageReclaimPromise = null;
    });
    return this.storageReclaimPromise;
  }

  private async cleanupDisposableLocalData(currentCaptureId: string): Promise<void> {
    const captures = await this.getAll<PersistedCapture>(CAPTURE_STORE);
    for (const capture of captures) {
      if (capture.captureId === currentCaptureId) continue;
      capture.outages ??= [];
      capture.activeReasons ??= [];
      capture.activeOutageStartedAt ??= null;

      const expiredFailure =
        !!capture.failedAt && Date.now() - capture.failedAt >= FAILED_RETENTION_MS;
      const hasNoRepair = capture.outages.length === 0 && capture.activeOutageStartedAt === null;
      if (expiredFailure || hasNoRepair) {
        await this.deleteLocalCapture(capture.captureId);
        continue;
      }

      if (!navigator.onLine) continue;
      let status: RecordingRepairStatus | null = null;
      try {
        status = await recordingService.getRecordingRepairStatus(capture.callId, capture.captureId);
      } catch {
        // A missing/unreachable status is not proof that server-side coverage exists.
      }
      if (status) {
        if (status.status === 'MERGED') {
          await this.deleteLocalCapture(capture.captureId);
        } else {
          // A server-side capture status proves finalize already validated full
          // object-storage coverage, so any leftover local copies are redundant.
          await this.deleteLocalChunks(capture.captureId);
        }
        continue;
      }
      try {
        // Drain older, not-yet-finalized captures too. Each local Blob is deleted
        // only after its checksummed upload receives a successful acknowledgement.
        await this.uploadPending(capture, true);
      } catch {
        // Preserve any chunk whose upload was not acknowledged.
      }
    }
  }

  private async uploadPending(
    capture: PersistedCapture,
    includeActiveOutage = false,
  ): Promise<void> {
    if (!navigator.onLine) return;
    const outages = this.outagesForUpload(capture, includeActiveOutage);
    const chunks = (await this.getChunksForCapture(capture.captureId)).sort(
      (left, right) => left.sequence - right.sequence,
    );
    for (const chunk of chunks) {
      if (!this.overlapsOutage(chunk, outages)) continue;
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
      // A successful response means the backend durably accepted this exact,
      // checksummed chunk. Keep capture metadata for finalize/status recovery,
      // but release the much larger local Blob immediately.
      await this.deleteChunk(chunk.id);
    }
  }

  private queueUpload(capture: PersistedCapture): Promise<void> {
    const upload = this.pendingUpload
      .catch(() => undefined)
      .then(() => this.uploadPending(capture));
    this.pendingUpload = upload.catch(() => undefined);
    return upload;
  }

  private outagesForUpload(
    capture: PersistedCapture,
    includeActiveOutage: boolean,
  ): RecordingRepairOutage[] {
    if (
      !includeActiveOutage ||
      capture.activeOutageStartedAt === null ||
      capture.activeReasons.length === 0
    ) {
      return capture.outages;
    }
    return [
      ...capture.outages,
      {
        startedAt: new Date(capture.activeOutageStartedAt).toISOString(),
        endedAt: new Date().toISOString(),
        reasons: capture.activeReasons,
      },
    ];
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
    const pending = captures.filter(capture => capture.captureId !== this.capture?.captureId);
    let cursor = 0;
    const recoverOne = async (capture: PersistedCapture): Promise<void> => {
      capture.outages ??= [];
      capture.activeReasons ??= [];
      capture.activeOutageStartedAt ??= null;
      if (capture.failedAt && Date.now() - capture.failedAt >= FAILED_RETENTION_MS) {
        await this.deleteLocalCapture(capture.captureId);
        return;
      }
      if (capture.activeOutageStartedAt !== null && capture.activeReasons.length > 0) {
        const endedAt = capture.lastDurableChunkEndedAt ?? capture.activeOutageStartedAt;
        if (endedAt > capture.activeOutageStartedAt) {
          capture.outages.push({
            startedAt: new Date(capture.activeOutageStartedAt).toISOString(),
            endedAt: new Date(endedAt).toISOString(),
            reasons: capture.activeReasons,
          });
        }
        capture.activeOutageStartedAt = null;
        await this.saveCapture(capture);
      }
      if (capture.outages.length === 0) {
        await this.deleteLocalCapture(capture.captureId);
        return;
      }
      try {
        await this.queueUpload(capture);
        await recordingService.finalizeRecordingRepair(
          capture.callId,
          capture.captureId,
          capture.outages,
        );
        this.scheduleCleanupIfMerged(capture);
      } catch {
        // Preserve durable data for the next online/application initialization.
      }
    };
    const workers = Array.from({ length: Math.min(3, pending.length) }, async () => {
      while (cursor < pending.length) {
        const capture = pending[cursor++];
        if (capture) await recoverOne(capture);
      }
    });
    await Promise.all(workers);
  }

  private scheduleCleanupIfMerged(capture: PersistedCapture): void {
    if (this.statusPolls.has(capture.captureId)) return;
    const poll = this.cleanupIfMerged(capture).finally(() => {
      if (this.statusPolls.get(capture.captureId) === poll) {
        this.statusPolls.delete(capture.captureId);
      }
    });
    this.statusPolls.set(capture.captureId, poll);
  }

  private async cleanupIfMerged(capture: PersistedCapture): Promise<void> {
    let pollDelayMs = POLL_INTERVAL_MS;
    while (navigator.onLine) {
      let status: RecordingRepairStatus;
      try {
        status = await recordingService.getRecordingRepairStatus(capture.callId, capture.captureId);
      } catch {
        await new Promise(resolve => setTimeout(resolve, pollDelayMs));
        pollDelayMs = Math.min(30_000, Math.round(pollDelayMs * 1.5));
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
      if (status.status === 'FAILED' && !status.retryable) {
        capture.failedAt ??= Date.now();
        if (!capture.failureWarned) {
          capture.failureWarned = true;
          toast.warning('A recording gap could not be repaired automatically');
        }
        await this.saveCapture(capture);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, pollDelayMs));
      pollDelayMs = Math.min(30_000, Math.round(pollDelayMs * 1.5));
    }
  }

  private async saveCapture(capture: PersistedCapture): Promise<void> {
    await this.transaction(CAPTURE_STORE, 'readwrite', store =>
      store.put(this.toPersistedCapture(capture)),
    );
  }

  private toPersistedCapture(capture: PersistedCapture): PersistedCapture {
    return {
      captureId: capture.captureId,
      callId: capture.callId,
      sequence: capture.sequence,
      outages: capture.outages,
      activeReasons: capture.activeReasons,
      activeOutageStartedAt: capture.activeOutageStartedAt,
      ...(capture.lastDurableChunkEndedAt
        ? { lastDurableChunkEndedAt: capture.lastDurableChunkEndedAt }
        : {}),
      ...(capture.failedAt ? { failedAt: capture.failedAt } : {}),
      ...(capture.failureWarned ? { failureWarned: true } : {}),
    };
  }

  private async saveChunksAndCapture(
    chunks: StoredChunk[],
    capture: PersistedCapture,
  ): Promise<void> {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([CHUNK_STORE, CAPTURE_STORE], 'readwrite');
      let settled = false;
      let requestError: DOMException | null = null;
      try {
        const chunkStore = transaction.objectStore(CHUNK_STORE);
        const requests = [
          ...chunks.map(chunk => chunkStore.put(chunk)),
          transaction.objectStore(CAPTURE_STORE).put({
            ...this.toPersistedCapture(capture),
            lastDurableChunkEndedAt: Math.max(
              capture.lastDurableChunkEndedAt ?? 0,
              ...chunks.map(chunk => chunk.endedAt),
            ),
          }),
        ];
        for (const request of requests) {
          request.onerror = (): void => {
            requestError ??= request.error;
          };
        }
      } catch (error) {
        settled = true;
        try {
          transaction.abort();
        } catch {
          // The transaction may already be inactive after a synchronous failure.
        }
        database.close();
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      transaction.oncomplete = (): void => {
        if (settled) return;
        settled = true;
        database.close();
        if (chunks.length > 0) {
          capture.lastDurableChunkEndedAt = Math.max(
            capture.lastDurableChunkEndedAt ?? 0,
            ...chunks.map(chunk => chunk.endedAt),
          );
        }
        resolve();
      };
      const rejectTransaction = (): void => {
        if (settled) return;
        settled = true;
        database.close();
        reject(requestError ?? transaction.error ?? new Error('IndexedDB transaction failed'));
      };
      transaction.onerror = rejectTransaction;
      transaction.onabort = rejectTransaction;
    });
  }

  private async deleteLocalCapture(captureId: string): Promise<void> {
    await this.deleteCaptureData(captureId, true);
  }

  private async deleteLocalChunks(captureId: string): Promise<void> {
    await this.deleteCaptureData(captureId, false);
  }

  private async deleteCaptureData(captureId: string, includeCapture: boolean): Promise<void> {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const storeNames = includeCapture ? [CHUNK_STORE, CAPTURE_STORE] : [CHUNK_STORE];
      const transaction = database.transaction(storeNames, 'readwrite');
      let requestError: DOMException | null = null;
      let settled = false;
      const chunks = transaction.objectStore(CHUNK_STORE);
      const cursor = chunks.index('captureId').openKeyCursor(IDBKeyRange.only(captureId));
      cursor.onsuccess = (): void => {
        const result = cursor.result;
        if (!result) return;
        const deletion = chunks.delete(result.primaryKey);
        deletion.onerror = (): void => {
          requestError ??= deletion.error;
        };
        result.continue();
      };
      cursor.onerror = (): void => {
        requestError ??= cursor.error;
      };
      if (includeCapture) {
        const deletion = transaction.objectStore(CAPTURE_STORE).delete(captureId);
        deletion.onerror = (): void => {
          requestError ??= deletion.error;
        };
      }
      transaction.oncomplete = (): void => {
        if (settled) return;
        settled = true;
        database.close();
        resolve();
      };
      const rejectTransaction = (): void => {
        if (settled) return;
        settled = true;
        database.close();
        reject(requestError ?? transaction.error ?? new Error('IndexedDB cleanup failed'));
      };
      transaction.onerror = rejectTransaction;
      transaction.onabort = rejectTransaction;
    });
  }

  private async deleteChunk(chunkId: string): Promise<void> {
    await this.transaction(CHUNK_STORE, 'readwrite', store => store.delete(chunkId));
  }

  private getAll<T>(storeName: string): Promise<T[]> {
    return this.transaction<T[]>(storeName, 'readonly', store => store.getAll() as IDBRequest<T[]>);
  }

  private getChunksForCapture(captureId: string): Promise<StoredChunk[]> {
    return this.transaction<StoredChunk[]>(
      CHUNK_STORE,
      'readonly',
      store =>
        store.index('captureId').getAll(IDBKeyRange.only(captureId)) as IDBRequest<StoredChunk[]>,
    );
  }

  private async transaction<T>(
    storeName: string,
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      let request: IDBRequest<T>;
      try {
        request = operation(transaction.objectStore(storeName));
      } catch (error) {
        database.close();
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      let result!: T;
      let requestError: DOMException | null = null;
      let settled = false;
      request.onsuccess = (): void => {
        result = request.result;
      };
      request.onerror = (): void => {
        requestError = request.error ?? new DOMException('IndexedDB request failed');
      };
      transaction.oncomplete = (): void => {
        if (settled) return;
        settled = true;
        database.close();
        resolve(result);
      };
      const rejectTransaction = (): void => {
        if (settled) return;
        settled = true;
        database.close();
        reject(requestError ?? transaction.error ?? new Error('IndexedDB transaction failed'));
      };
      transaction.onerror = rejectTransaction;
      transaction.onabort = rejectTransaction;
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
