import { toast } from 'sonner';
import type { RecordingCaptureManifest } from '@xyne/shared';
import {
  RECORDING_REPAIR_MERGED_EVENT,
  recordingService,
  type RecordingRepairMergedEventDetail,
  type RecordingRepairReason,
} from './recordingService';
import {
  selectRecordingArchiveStore,
  createManifest,
  sha256Hex,
  lastDurableEndedAtMs,
} from './archive';
import type { OpenArchiveCapture, RecordingArchiveStore } from './archive/types';
import { getRecordingRepairUploader } from './archive/uploader';
import { isCaptureSettled, markCaptureSettled } from './archive/settledCaptures';

// Offline-first note-taker recorder. One long-lived MediaRecorder records the WHOLE
// call into a single continuous recording.webm on the user's disk (Electron native FS
// / File System Access / OPFS fallback). Outages only decide which byte ranges get
// uploaded to GCS for transcript repair — the local archive is always the full call.

export const RECORDING_STORAGE_EXHAUSTED_EVENT = 'xyne-recording-storage-exhausted';

const FRAGMENT_TIMESLICE_MS = 10_000;
// Match livekit-client's default mono AudioPresets publish ceiling.
const FALLBACK_AUDIO_BITS_PER_SECOND = 48_000;
const STORAGE_CHECK_INTERVAL_MS = 60_000;
const STORAGE_LOW_REMAINING_MS = 2 * 60 * 60_000;
const STORAGE_FLOOR_BYTES = 250 * 1024 * 1024;
const POLL_INTERVAL_MS = 2_000;
const POLL_MAX_MS = 30_000;

interface ActiveCapture {
  callId: string;
  captureId: string;
  store: RecordingArchiveStore;
  open: OpenArchiveCapture;
  manifest: RecordingCaptureManifest;
  audioContext: AudioContext;
  destination: MediaStreamAudioDestinationNode;
  source: MediaStreamAudioSourceNode;
  recorder: MediaRecorder;
  trackId: string;
  lastFragmentEndedAt: number;
  activeReasons: Set<RecordingRepairReason>;
  activeOutageIndex: number | null;
  mutationTail: Promise<void>;
  stopping: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function pickMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
  if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm';
  return null;
}

function needsRepair(manifest: RecordingCaptureManifest): boolean {
  return manifest.offlineAtStart || manifest.outages.length > 0;
}

export class OfflineRecordingService {
  private capture: ActiveCapture | null = null;
  private startPromise: Promise<void> | null = null;
  private startingCallId: string | null = null;
  private recoveryPromise: Promise<void> | null = null;
  private statusPolls = new Map<string, Promise<void>>();
  private warnedPersistenceDenied = false;
  private warnedLowStorage = false;
  private lastStorageCheckAt = 0;

  async initialize(): Promise<void> {
    if (typeof window === 'undefined') return;
    const store = selectRecordingArchiveStore();
    if (!store) throw new Error('No recording archive storage is available');
    const { persistent } = await store.init();
    if (!persistent && !this.warnedPersistenceDenied) {
      this.warnedPersistenceDenied = true;
      toast.warning('Persistent recording storage was not granted', {
        description:
          'Local audio is still saved, but the browser may remove it under storage pressure.',
        duration: Infinity,
        closeButton: true,
      });
    }
    this.scheduleRecovery();
  }

  async start(
    callId: string,
    track: MediaStreamTrack,
    options?: { offlineAtStart?: boolean },
  ): Promise<void> {
    if (this.capture?.callId === callId) {
      if (this.capture.trackId !== track.id) this.replaceTrack(this.capture, track);
      return;
    }
    if (this.capture) throw new Error('A local recording capture is already active');
    if (this.startPromise) {
      if (this.startingCallId !== callId)
        throw new Error('A local recording capture is already starting');
      await this.startPromise;
      return this.start(callId, track, options);
    }
    this.startingCallId = callId;
    this.startPromise = this.startCapture(callId, track, options).finally(() => {
      this.startPromise = null;
      this.startingCallId = null;
    });
    return this.startPromise;
  }

  private async startCapture(
    callId: string,
    track: MediaStreamTrack,
    options?: { offlineAtStart?: boolean },
  ): Promise<void> {
    const store = selectRecordingArchiveStore();
    if (!store) throw new Error('No recording archive storage is available');
    const mimeType = pickMimeType();
    if (!mimeType) throw new Error('WebM audio recording is unavailable in this browser');

    // Route the mic through a stable Web-Audio destination so the MediaRecorder
    // records ONE unchanging stream; switching microphones swaps the upstream
    // source without restarting the recorder (fragments stay concatenable).
    const audioContext = new AudioContext();
    await audioContext.resume().catch(() => undefined);
    const destination = audioContext.createMediaStreamDestination();
    const source = audioContext.createMediaStreamSource(new MediaStream([track]));
    source.connect(destination);

    const captureId = crypto.randomUUID();
    const startedAt = Date.now();
    const offlineAtStart = options?.offlineAtStart ?? !navigator.onLine;

    const open = await store.createCapture({
      callId,
      captureId,
      mimeType,
      audioBitsPerSecond: FALLBACK_AUDIO_BITS_PER_SECOND,
      startedAt,
      offlineAtStart,
    });
    const manifest = createManifest({
      callId,
      captureId,
      mimeType,
      audioBitsPerSecond: FALLBACK_AUDIO_BITS_PER_SECOND,
      startedAt,
      offlineAtStart,
    });

    const recorder = new MediaRecorder(destination.stream, {
      mimeType,
      audioBitsPerSecond: FALLBACK_AUDIO_BITS_PER_SECOND,
    });
    const capture: ActiveCapture = {
      callId,
      captureId,
      store,
      open,
      manifest,
      audioContext,
      destination,
      source,
      recorder,
      trackId: track.id,
      lastFragmentEndedAt: startedAt,
      activeReasons: new Set(),
      activeOutageIndex: null,
      mutationTail: Promise.resolve(),
      stopping: false,
    };
    recorder.ondataavailable = (event: BlobEvent): void => this.onFragment(capture, event.data);
    recorder.onerror = (): void => {
      toast.warning('Local recording protection stopped unexpectedly');
    };
    this.capture = capture;
    this.warnedLowStorage = false;
    this.lastStorageCheckAt = 0;
    recorder.start(FRAGMENT_TIMESLICE_MS);
  }

  private onFragment(capture: ActiveCapture, bytes: Blob): void {
    if (!bytes.size) return;
    const startedAtMs = capture.lastFragmentEndedAt;
    const endedAtMs = Date.now();
    capture.lastFragmentEndedAt = endedAtMs;
    this.enqueue(capture, async () => {
      const sha256 = await sha256Hex(bytes);
      const { byteOffset, byteLength } = await capture.open.appendFragment(bytes);
      capture.manifest.chunks.push({
        sequence: capture.manifest.chunks.length,
        byteOffset,
        byteLength,
        startedAtMs,
        endedAtMs,
        sha256,
      });
      // Keep the currently-open outage's end fresh so a crash mid-outage still
      // repairs up to the last durably stored fragment.
      if (capture.activeOutageIndex !== null) {
        const outage = capture.manifest.outages[capture.activeOutageIndex];
        if (outage) outage.endedAtMs = Math.max(outage.endedAtMs, endedAtMs);
      }
      await capture.open.writeManifest(capture.manifest);
    });
    void this.monitorStorage(capture);
  }

  setReason(reason: RecordingRepairReason, active: boolean, occurredAt = Date.now()): void {
    const capture = this.capture;
    if (!capture) return;
    if (active) {
      capture.activeReasons.add(reason);
      if (capture.activeOutageIndex === null) {
        const startedAtMs = occurredAt;
        const endedAtMs = Math.max(startedAtMs + 1, lastDurableEndedAtMs(capture.manifest));
        capture.manifest.outages.push({ startedAtMs, endedAtMs, reasons: [reason] });
        capture.activeOutageIndex = capture.manifest.outages.length - 1;
      } else {
        const outage = capture.manifest.outages[capture.activeOutageIndex];
        if (outage && !outage.reasons.includes(reason)) outage.reasons.push(reason);
      }
    } else {
      capture.activeReasons.delete(reason);
      if (capture.activeReasons.size === 0 && capture.activeOutageIndex !== null) {
        const outage = capture.manifest.outages[capture.activeOutageIndex];
        if (outage) outage.endedAtMs = Math.max(outage.endedAtMs, occurredAt);
        capture.activeOutageIndex = null;
      }
    }
    this.persistManifest(capture);
  }

  addMarkedMoment(text: string, occurredAt = Date.now()): void {
    const capture = this.capture;
    if (!capture || !text.trim()) return;
    capture.manifest.markedMoments.push({
      id: crypto.randomUUID(),
      timestampSeconds: Math.max(0, (occurredAt - capture.manifest.startedAt) / 1000),
      text: text.trim(),
      serverAcknowledged: false,
    });
    this.persistManifest(capture);
  }

  pause(): void {
    const capture = this.capture;
    if (capture?.recorder.state === 'recording') capture.recorder.pause();
  }

  resume(): void {
    const capture = this.capture;
    if (capture?.recorder.state === 'paused') capture.recorder.resume();
  }

  /** Best effort for a normal page close; hard crashes recover to the last durable fragment. */
  prepareForPageHide(): void {
    const capture = this.capture;
    if (capture && capture.recorder.state !== 'inactive') capture.recorder.stop();
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
    this.capture = null;
    capture.stopping = true;

    await this.stopRecorder(capture);
    await capture.mutationTail.catch(() => undefined);

    if (capture.activeOutageIndex !== null) {
      const outage = capture.manifest.outages[capture.activeOutageIndex];
      if (outage)
        outage.endedAtMs = Math.max(outage.endedAtMs, lastDurableEndedAtMs(capture.manifest));
      capture.activeOutageIndex = null;
    }
    capture.manifest.completed = true;
    capture.manifest.endedAt = Date.now();
    await capture.open.writeManifest(capture.manifest).catch(() => undefined);
    await capture.open.finalize().catch(() => undefined);
    this.closeAudio(capture);

    await this.processCapture(
      capture.store,
      capture.callId,
      capture.captureId,
      capture.manifest,
      (offset, length) => capture.open.readRange(offset, length),
      manifest => capture.open.writeManifest(manifest),
    );
    await capture.open.close().catch(() => undefined);
  }

  private replaceTrack(capture: ActiveCapture, track: MediaStreamTrack): void {
    if (capture.trackId === track.id) return;
    try {
      capture.source.disconnect();
      capture.source = capture.audioContext.createMediaStreamSource(new MediaStream([track]));
      capture.source.connect(capture.destination);
      capture.trackId = track.id;
    } catch {
      // If the new track cannot be wired, the recorder keeps the previous source.
    }
  }

  private stopRecorder(capture: ActiveCapture): Promise<void> {
    return new Promise(resolve => {
      const recorder = capture.recorder;
      if (recorder.state === 'inactive') {
        resolve();
        return;
      }
      recorder.addEventListener('stop', () => resolve(), { once: true });
      try {
        recorder.stop();
      } catch {
        resolve();
      }
    });
  }

  private closeAudio(capture: ActiveCapture): void {
    try {
      capture.source.disconnect();
      capture.destination.disconnect();
    } catch {
      // ignore graph teardown races
    }
    void capture.audioContext.close().catch(() => undefined);
  }

  private enqueue(capture: ActiveCapture, op: () => Promise<void>): void {
    const run = capture.mutationTail.then(op, op);
    capture.mutationTail = run
      .then(
        () => undefined,
        error => {
          toast.warning('Local recording protection is unavailable');
          throw error;
        },
      )
      .catch(() => undefined);
  }

  private persistManifest(capture: ActiveCapture): void {
    this.enqueue(capture, () => capture.open.writeManifest(capture.manifest));
  }

  private async monitorStorage(capture: ActiveCapture): Promise<void> {
    const now = Date.now();
    if (now - this.lastStorageCheckAt < STORAGE_CHECK_INTERVAL_MS) return;
    this.lastStorageCheckAt = now;
    try {
      const { availableBytes } = await capture.store.freeSpace();
      if (availableBytes === null) return;
      if (availableBytes < STORAGE_FLOOR_BYTES) {
        this.stopForStorageExhaustion(capture);
        return;
      }
      const bytesPerMs = FALLBACK_AUDIO_BITS_PER_SECOND / 8 / 1000;
      if (availableBytes / bytesPerMs <= STORAGE_LOW_REMAINING_MS && !this.warnedLowStorage) {
        this.warnedLowStorage = true;
        const minutes = Math.max(1, Math.floor(availableBytes / bytesPerMs / 60_000));
        toast.warning('Local recording storage is running low', {
          description: `Approximately ${minutes} minutes of recording capacity remains.`,
        });
      }
    } catch {
      // Estimates are advisory; a failed estimate must not interrupt capture.
    }
  }

  private stopForStorageExhaustion(capture: ActiveCapture): void {
    if (capture.stopping) return;
    capture.stopping = true;
    if (capture.recorder.state !== 'inactive') capture.recorder.stop();
    toast.error('Recording stopped because local storage is full', {
      description: 'Audio could no longer be saved safely.',
      duration: Infinity,
      closeButton: true,
    });
    window.dispatchEvent(new Event(RECORDING_STORAGE_EXHAUSTED_EVENT));
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
    const store = selectRecordingArchiveStore();
    if (!store) return;
    const captures = await store.listPendingCaptures();
    for (const stored of captures) {
      if (stored.captureId === this.capture?.captureId) continue;
      let manifest = stored.manifest;
      if (!manifest.completed) {
        // Crashed mid-recording: close the archive at the last durable fragment.
        manifest = {
          ...manifest,
          completed: true,
          endedAt: manifest.endedAt ?? lastDurableEndedAtMs(manifest),
        };
        await stored.writeManifest(manifest).catch(() => undefined);
      }
      await this.processCapture(
        store,
        manifest.callId,
        stored.captureId,
        manifest,
        (offset, length) => stored.readRange(offset, length),
        next => stored.writeManifest(next),
      );
    }
  }

  private async processCapture(
    store: RecordingArchiveStore,
    callId: string,
    captureId: string,
    manifest: RecordingCaptureManifest,
    readRange: (byteOffset: number, byteLength: number) => Promise<Blob>,
    persistManifest: (manifest: RecordingCaptureManifest) => Promise<void>,
  ): Promise<void> {
    if (isCaptureSettled(captureId)) {
      if (store.kind === 'opfs') await store.deleteCapture(captureId).catch(() => undefined);
      return;
    }
    // A fully-online call needs no server repair; the local recording.webm remains
    // the user's archive. Settle so recovery stops re-scanning it.
    if (!needsRepair(manifest)) {
      markCaptureSettled(captureId);
      if (store.kind === 'opfs') await store.deleteCapture(captureId).catch(() => undefined);
      return;
    }
    const uploader = getRecordingRepairUploader();
    if (!uploader) return; // upload path not yet registered; retry on next init/online
    try {
      await uploader.uploadCapture({ callId, captureId, manifest, readRange, persistManifest });
    } catch {
      return; // preserve local data; retry on next init/online
    }
    void this.pollUntilSettled(store, callId, captureId);
  }

  private pollUntilSettled(store: RecordingArchiveStore, callId: string, captureId: string): void {
    if (this.statusPolls.has(captureId)) return;
    const poll = (async (): Promise<void> => {
      let delay = POLL_INTERVAL_MS;
      while (navigator.onLine) {
        let status: Awaited<ReturnType<typeof recordingService.getRecordingRepairStatus>>;
        try {
          status = await recordingService.getRecordingRepairStatus(callId, captureId);
        } catch {
          await sleep(delay);
          delay = Math.min(POLL_MAX_MS, Math.round(delay * 1.5));
          continue;
        }
        if (status.status === 'MERGED') {
          const detail: RecordingRepairMergedEventDetail = { callId, captureId };
          window.dispatchEvent(new CustomEvent(RECORDING_REPAIR_MERGED_EVENT, { detail }));
          markCaptureSettled(captureId);
          if (store.kind === 'opfs') await store.deleteCapture(captureId).catch(() => undefined);
          return;
        }
        if (status.status === 'FAILED' && !status.retryable) {
          markCaptureSettled(captureId);
          toast.warning('A recording gap could not be repaired automatically');
          return;
        }
        await sleep(delay);
        delay = Math.min(POLL_MAX_MS, Math.round(delay * 1.5));
      }
    })().finally(() => {
      if (this.statusPolls.get(captureId) === poll) this.statusPolls.delete(captureId);
    });
    this.statusPolls.set(captureId, poll);
  }
}

export const offlineRecordingService = new OfflineRecordingService();
