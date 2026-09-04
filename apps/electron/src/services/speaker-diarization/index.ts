/**
 * On-device speaker diarization ("speaker disambiguation") — main-process service.
 *
 * Responsibilities:
 *  1. Persist the user preference (electron-store, like the recording pill).
 *  2. Download + verify the Sherpa-ONNX models into userData, reporting progress
 *     so the renderer can show it in a toast.
 *  3. Accept 16 kHz PCM chunks from the renderer's microphone tap during a
 *     recording, spool them to disk, and on finish run diarization in a
 *     utilityProcess worker. The resulting speaker segments go back to the
 *     renderer, which uploads them to the backend against the recording.
 *
 * Nothing here touches the network except the model download; audio never
 * leaves the machine through this service.
 */
import { app, net, utilityProcess, type UtilityProcess } from 'electron';
import Store from 'electron-store';
import log from 'electron-log/main';
import { createHash, randomUUID } from 'crypto';
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync, readdirSync, type WriteStream } from 'fs';
import os from 'os';
import path from 'path';
import {
  DIARIZATION_MODEL_FILES,
  DIARIZATION_MODEL_VERSION,
  DIARIZATION_SAMPLE_RATE,
  DIARIZATION_TOTAL_DOWNLOAD_BYTES,
  type DiarizationModelFile,
} from './models';

export interface SpeakerSegment {
  start: number;
  end: number;
  speaker: number;
}

export interface DiarizationResult {
  segments: SpeakerSegment[];
  durationSeconds: number;
  sampleRate: number;
  /** Seconds of speech attributed to each speaker index (diagnostics). */
  speakerSeconds?: Record<number, number>;
  /** Clusters folded into a neighbour as too small to be a real speaker. */
  mergedMinorSpeakers?: number;
  /** Short isolated segments reassigned to the surrounding speaker. */
  smoothedSegments?: number;
}

export type DiarizationDownloadState = 'idle' | 'downloading' | 'error';

export interface SpeakerDiarizationStatus {
  enabled: boolean;
  modelsReady: boolean;
  modelVersion: number;
  download: {
    state: DiarizationDownloadState;
    receivedBytes: number;
    totalBytes: number;
    error: string | null;
  };
  /** Whether a diarization job is currently running. */
  processing: boolean;
}

const ENABLED_KEY = 'enabled';
const MODEL_VERSION_KEY = 'modelVersion';
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
const WORKER_TIMEOUT_MS = 30 * 60_000;
// Sessions older than this on startup are leftovers from a crash; delete them.
const STALE_SESSION_MS = 24 * 60 * 60_000;

const store = new Store({ name: 'speaker-diarization' });

const statusListeners = new Set<(status: SpeakerDiarizationStatus) => void>();

let downloadState: SpeakerDiarizationStatus['download'] = {
  state: 'idle',
  receivedBytes: 0,
  totalBytes: DIARIZATION_TOTAL_DOWNLOAD_BYTES,
  error: null,
};
let downloadAbort: AbortController | null = null;
let downloadPromise: Promise<void> | null = null;

interface AudioSession {
  id: string;
  pcmPath: string;
  stream: WriteStream;
  bytesWritten: number;
  createdAt: number;
}
const sessions = new Map<string, AudioSession>();
let workerQueue: Promise<unknown> = Promise.resolve();
let processing = false;

// ── Paths ───────────────────────────────────────────────────────────────────

function getRootDir(): string {
  return path.join(app.getPath('userData'), 'speaker-diarization');
}
function getModelDir(): string {
  return path.join(getRootDir(), 'models', `v${DIARIZATION_MODEL_VERSION}`);
}
function getSessionsDir(): string {
  return path.join(getRootDir(), 'sessions');
}
function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ── Status ──────────────────────────────────────────────────────────────────

export function isSpeakerDiarizationEnabled(): boolean {
  return store.get(ENABLED_KEY, false) as boolean;
}

function modelFileReady(file: DiarizationModelFile): boolean {
  const filePath = path.join(getModelDir(), file.fileName);
  try {
    return existsSync(filePath) && statSync(filePath).size === file.sizeBytes;
  } catch {
    return false;
  }
}

export function areModelsReady(): boolean {
  const storedVersion = store.get(MODEL_VERSION_KEY, 0) as number;
  return storedVersion === DIARIZATION_MODEL_VERSION && DIARIZATION_MODEL_FILES.every(modelFileReady);
}

export function getSpeakerDiarizationStatus(): SpeakerDiarizationStatus {
  return {
    enabled: isSpeakerDiarizationEnabled(),
    modelsReady: areModelsReady(),
    modelVersion: DIARIZATION_MODEL_VERSION,
    download: { ...downloadState },
    processing,
  };
}

/** Enabled by the user AND models present — the only state in which recordings are diarized. */
export function isSpeakerDiarizationActive(): boolean {
  return isSpeakerDiarizationEnabled() && areModelsReady();
}

export function onSpeakerDiarizationStatusChange(
  listener: (status: SpeakerDiarizationStatus) => void,
): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

function emitStatus(): void {
  const status = getSpeakerDiarizationStatus();
  for (const listener of statusListeners) {
    try {
      listener(status);
    } catch (error) {
      log.warn('[SpeakerDiarization] status listener threw', error);
    }
  }
}

export function setSpeakerDiarizationEnabled(enabled: boolean): void {
  store.set(ENABLED_KEY, enabled);
  log.info('[SpeakerDiarization] enabled =', enabled);
  if (!enabled && downloadAbort) {
    // Turning the feature off mid-download cancels it; models are kept if already complete.
    downloadAbort.abort();
  }
  emitStatus();
}

// ── Model download ──────────────────────────────────────────────────────────

class DownloadCancelled extends Error {
  constructor() {
    super('Download cancelled');
    this.name = 'DownloadCancelled';
  }
}

async function downloadFile(
  file: DiarizationModelFile,
  signal: AbortSignal,
  onBytes: (delta: number) => void,
): Promise<void> {
  const modelDir = getModelDir();
  ensureDir(modelDir);
  const finalPath = path.join(modelDir, file.fileName);
  const partialPath = `${finalPath}.partial`;
  if (existsSync(partialPath)) rmSync(partialPath, { force: true });

  log.info('[SpeakerDiarization] downloading', file.id, 'from', file.url);
  const response = await net.fetch(file.url, { signal, redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed for ${file.id}: HTTP ${response.status}`);
  }

  const hash = createHash('sha256');
  const out = createWriteStream(partialPath);
  const reader = response.body.getReader();
  let received = 0;

  try {
    for (;;) {
      if (signal.aborted) throw new DownloadCancelled();
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      hash.update(chunk);
      received += chunk.length;
      if (received > file.sizeBytes) {
        throw new Error(`Download for ${file.id} exceeded the expected size`);
      }
      onBytes(chunk.length);
      if (!out.write(chunk)) {
        await new Promise<void>((resolve) => out.once('drain', resolve));
      }
    }
    await new Promise<void>((resolve, reject) => {
      out.once('error', reject);
      out.end(resolve);
    });
  } catch (error) {
    out.destroy();
    rmSync(partialPath, { force: true });
    throw error;
  }

  if (received !== file.sizeBytes) {
    rmSync(partialPath, { force: true });
    throw new Error(`Download for ${file.id} was truncated (${received} of ${file.sizeBytes} bytes)`);
  }
  const digest = hash.digest('hex');
  if (digest !== file.sha256) {
    rmSync(partialPath, { force: true });
    throw new Error(`Checksum mismatch for ${file.id}`);
  }
  renameSync(partialPath, finalPath);
  log.info('[SpeakerDiarization] downloaded + verified', file.id);
}

/**
 * Download every missing model file. Resolves when all files are present and
 * verified; rejects on failure or cancellation. Concurrent callers share one
 * in-flight download. Progress is pushed through onSpeakerDiarizationStatusChange.
 */
export function downloadSpeakerDiarizationModels(): Promise<void> {
  if (downloadPromise) return downloadPromise;
  if (areModelsReady()) return Promise.resolve();

  const abort = new AbortController();
  downloadAbort = abort;
  downloadState = { state: 'downloading', receivedBytes: 0, totalBytes: DIARIZATION_TOTAL_DOWNLOAD_BYTES, error: null };
  emitStatus();

  const timeout = setTimeout(() => abort.abort(), DOWNLOAD_TIMEOUT_MS);

  downloadPromise = (async () => {
    try {
      // Files already present (e.g. a retry after one succeeded) count as received.
      for (const file of DIARIZATION_MODEL_FILES) {
        if (modelFileReady(file)) {
          downloadState.receivedBytes += file.sizeBytes;
          continue;
        }
        await downloadFile(file, abort.signal, (delta) => {
          downloadState.receivedBytes += delta;
          emitStatus();
        });
      }
      store.set(MODEL_VERSION_KEY, DIARIZATION_MODEL_VERSION);
      downloadState = { state: 'idle', receivedBytes: DIARIZATION_TOTAL_DOWNLOAD_BYTES, totalBytes: DIARIZATION_TOTAL_DOWNLOAD_BYTES, error: null };
      log.info('[SpeakerDiarization] all models ready');
    } catch (error) {
      const cancelled = error instanceof DownloadCancelled || abort.signal.aborted;
      const message = cancelled
        ? 'Download cancelled'
        : error instanceof Error
          ? error.message
          : String(error);
      downloadState = {
        state: cancelled ? 'idle' : 'error',
        receivedBytes: 0,
        totalBytes: DIARIZATION_TOTAL_DOWNLOAD_BYTES,
        error: cancelled ? null : message,
      };
      log[cancelled ? 'info' : 'error']('[SpeakerDiarization] model download ended:', message);
      throw new Error(message);
    } finally {
      clearTimeout(timeout);
      downloadAbort = null;
      downloadPromise = null;
      emitStatus();
    }
  })();

  return downloadPromise;
}

export function cancelSpeakerDiarizationDownload(): void {
  downloadAbort?.abort();
}

// ── Audio sessions ──────────────────────────────────────────────────────────

export function beginDiarizationSession(): string {
  ensureDir(getSessionsDir());
  const id = randomUUID();
  const pcmPath = path.join(getSessionsDir(), `${id}.pcm`);
  const stream = createWriteStream(pcmPath);
  stream.on('error', (error) => log.error('[SpeakerDiarization] session write error', id, error));
  sessions.set(id, { id, pcmPath, stream, bytesWritten: 0, createdAt: Date.now() });
  log.info('[SpeakerDiarization] session started', id);
  return id;
}

export function appendDiarizationAudio(sessionId: string, chunk: Buffer): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;
  session.bytesWritten += chunk.length;
  session.stream.write(chunk);
  return true;
}

export function abortDiarizationSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  sessions.delete(sessionId);
  session.stream.destroy();
  rmSync(session.pcmPath, { force: true });
  log.info('[SpeakerDiarization] session aborted', sessionId);
}

function getWorkerPath(): string {
  return path.join(__dirname, 'worker.js');
}

function runWorker(pcmPath: string): Promise<DiarizationResult> {
  return new Promise<DiarizationResult>((resolve, reject) => {
    const files = Object.fromEntries(DIARIZATION_MODEL_FILES.map((f) => [f.id, f.fileName]));
    const numThreads = Math.max(1, Math.min(4, os.cpus().length - 1));
    let child: UtilityProcess;
    try {
      child = utilityProcess.fork(getWorkerPath(), [], {
        serviceName: 'xyne-speaker-diarization',
        stdio: 'pipe',
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
      // Give the worker a moment to flush, then make sure it is gone.
      setTimeout(() => {
        try {
          child.kill();
        } catch {
          /* already exited */
        }
      }, 250);
    };
    const timer = setTimeout(() => {
      finish(() => reject(new Error('Speaker diarization timed out')));
    }, WORKER_TIMEOUT_MS);

    child.stdout?.on('data', (data: Buffer) => log.info('[SpeakerDiarization:worker]', data.toString().trim()));
    child.stderr?.on('data', (data: Buffer) => log.warn('[SpeakerDiarization:worker]', data.toString().trim()));
    child.on('message', (message: {
      type?: string;
      segments?: SpeakerSegment[];
      durationSeconds?: number;
      speakerSeconds?: Record<number, number>;
      mergedMinorSpeakers?: number;
      smoothedSegments?: number;
      message?: string;
    }) => {
      if (message?.type === 'result') {
        finish(() =>
          resolve({
            segments: message.segments ?? [],
            durationSeconds: message.durationSeconds ?? 0,
            sampleRate: DIARIZATION_SAMPLE_RATE,
            speakerSeconds: message.speakerSeconds,
            mergedMinorSpeakers: message.mergedMinorSpeakers,
            smoothedSegments: message.smoothedSegments,
          }),
        );
      } else if (message?.type === 'error') {
        finish(() => reject(new Error(message.message || 'Speaker diarization failed')));
      }
    });
    child.on('exit', (code) => {
      finish(() => reject(new Error(`Speaker diarization worker exited with code ${code}`)));
    });

    child.postMessage({
      type: 'diarize',
      pcmPath,
      modelDir: getModelDir(),
      segmentationFile: files.segmentation,
      embeddingFile: files.embedding,
      numThreads,
    });
  });
}

/**
 * Close the session's PCM spool and diarize it. Jobs are serialized so two
 * back-to-back recordings never run two ONNX sessions at once.
 */
export async function finishDiarizationSession(sessionId: string): Promise<DiarizationResult> {
  const session = sessions.get(sessionId);
  if (!session) throw new Error('Unknown diarization session');
  sessions.delete(sessionId);

  await new Promise<void>((resolve, reject) => {
    session.stream.once('error', reject);
    session.stream.end(resolve);
  });
  if (!areModelsReady()) {
    rmSync(session.pcmPath, { force: true });
    throw new Error('Speaker diarization models are not installed');
  }

  const seconds = session.bytesWritten / 2 / DIARIZATION_SAMPLE_RATE;
  log.info('[SpeakerDiarization] session finished', sessionId, `${seconds.toFixed(1)}s of audio`);

  const job = workerQueue.then(async () => {
    processing = true;
    emitStatus();
    const startedAt = Date.now();
    try {
      const result = await runWorker(session.pcmPath);
      log.info('[SpeakerDiarization] diarized', sessionId, {
        audioSeconds: Number(result.durationSeconds.toFixed(1)),
        segments: result.segments.length,
        speakers: new Set(result.segments.map((s) => s.speaker)).size,
        speakerSeconds: result.speakerSeconds,
        mergedMinorSpeakers: result.mergedMinorSpeakers,
        smoothedSegments: result.smoothedSegments,
        elapsedMs: Date.now() - startedAt,
      });
      return result;
    } finally {
      processing = false;
      rmSync(session.pcmPath, { force: true });
      emitStatus();
    }
  });
  // Keep the queue alive even if this job rejects.
  workerQueue = job.catch(() => undefined);
  return job;
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

/**
 * Launch housekeeping: drop model directories from previous manifest versions
 * (the active one is models/v<DIARIZATION_MODEL_VERSION>) and PCM spools left
 * behind by a crash. Safe to call on every launch.
 */
export function initSpeakerDiarization(): void {
  try {
    const modelsRoot = path.join(getRootDir(), 'models');
    if (existsSync(modelsRoot)) {
      for (const entry of readdirSync(modelsRoot)) {
        if (entry === `v${DIARIZATION_MODEL_VERSION}`) continue;
        rmSync(path.join(modelsRoot, entry), { recursive: true, force: true });
        log.info('[SpeakerDiarization] removed stale model dir', entry);
      }
    }
  } catch (error) {
    log.warn('[SpeakerDiarization] stale model cleanup failed', error);
  }
  try {
    const dir = getSessionsDir();
    if (!existsSync(dir)) return;
    const now = Date.now();
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      try {
        if (now - statSync(full).mtimeMs > STALE_SESSION_MS) rmSync(full, { force: true });
        else if (!sessions.size) rmSync(full, { force: true }); // nothing can own it after a restart
      } catch {
        /* ignore */
      }
    }
  } catch (error) {
    log.warn('[SpeakerDiarization] cleanup failed', error);
  }
}
