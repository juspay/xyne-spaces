/**
 * Microphone tap for on-device speaker diarization (Electron only).
 *
 * A note-taker recording publishes the local microphone to LiveKit; the audio
 * itself is never kept on the client. When the desktop app has speaker
 * disambiguation enabled, this tap mirrors that same microphone track into a
 * 16 kHz mono PCM stream and forwards it to the Electron main process, which
 * spools it to disk and diarizes it once the recording stops.
 *
 * Pausing a recording mutes the LiveKit track (its MediaStreamTrack stays alive
 * but emits silence), so the tap keeps running and timestamps stay aligned with
 * the transcript.
 */
import { RoomEvent, Track, type Room } from 'livekit-client';
import { logger, Event } from '../../utils/logger';

export interface SpeakerSegment {
  start: number;
  end: number;
  speaker: number;
}

export interface LocalSpeakerTapResult {
  /** Epoch ms of the first captured sample; the backend aligns segments to it. */
  recordingStartedAt: number;
  durationSeconds: number;
  sampleRate: number;
  segments: SpeakerSegment[];
}

/** Window event fired once speaker labels were uploaded for a recording. detail: { callId }. */
export const SPEAKER_LABELS_APPLIED_EVENT = 'xyne:speaker-labels-applied';

const SAMPLE_RATE = 16_000;
// ScriptProcessor buffer (samples). 4096 @ 16 kHz = 256 ms per callback.
const PROCESSOR_BUFFER_SIZE = 4096;
// Batch ~1 s of audio per IPC message to keep message overhead negligible.
const FLUSH_SAMPLES = SAMPLE_RATE;

interface ActiveTap {
  sessionId: string;
  room: Room;
  context: AudioContext;
  source: MediaStreamAudioSourceNode | null;
  processor: ScriptProcessorNode;
  sink: GainNode;
  pending: Int16Array;
  pendingLength: number;
  startedAt: number | null;
  onLocalTrackPublished: () => void;
}

let active: ActiveTap | null = null;

function getMicTrack(room: Room): MediaStreamTrack | null {
  const publication = room.localParticipant.getTrackPublication(Track.Source.Microphone);
  const track = publication?.track?.mediaStreamTrack;
  return track && track.readyState === 'live' ? track : null;
}

function attachSource(tap: ActiveTap): void {
  const micTrack = getMicTrack(tap.room);
  if (!micTrack) return;
  try {
    tap.source?.disconnect();
  } catch {
    /* already disconnected */
  }
  tap.source = tap.context.createMediaStreamSource(new MediaStream([micTrack]));
  tap.source.connect(tap.processor);
}

function flush(tap: ActiveTap): void {
  if (tap.pendingLength === 0) return;
  const api = window.electronAPI?.speakerDiarization;
  if (!api) return;
  const chunk = tap.pending.slice(0, tap.pendingLength);
  api.pushAudio(tap.sessionId, chunk.buffer);
  tap.pendingLength = 0;
}

/**
 * Start tapping the room's microphone. No-op outside Electron or when the
 * preference is off / models are missing (main process refuses the session).
 */
export async function startLocalSpeakerTap(room: Room): Promise<void> {
  const api = window.electronAPI?.speakerDiarization;
  if (!api || active) return;

  let sessionId: string | null = null;
  try {
    sessionId = await api.beginSession();
  } catch {
    sessionId = null;
  }
  if (!sessionId) return;

  let context: AudioContext;
  try {
    context = new AudioContext({ sampleRate: SAMPLE_RATE });
  } catch (error) {
    api.abortSession(sessionId);
    logger.error(Event.RECORDING_ERROR, {
      error: `speaker tap: AudioContext failed: ${error instanceof Error ? error.message : String(error)}`,
    });
    return;
  }

  // ScriptProcessorNode is deprecated but needs no worklet module (which the
  // app's CSP would have to allow) and is universally supported in Chromium.
  const processor = context.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 1, 1);
  const sink = context.createGain();
  sink.gain.value = 0; // keep the graph pulling without producing sound
  processor.connect(sink);
  sink.connect(context.destination);

  const tap: ActiveTap = {
    sessionId,
    room,
    context,
    source: null,
    processor,
    sink,
    pending: new Int16Array(FLUSH_SAMPLES + PROCESSOR_BUFFER_SIZE),
    pendingLength: 0,
    startedAt: null,
    onLocalTrackPublished: () => attachSource(tap),
  };

  processor.onaudioprocess = (event: AudioProcessingEvent): void => {
    if (active !== tap) return;
    if (tap.startedAt === null) tap.startedAt = Date.now();
    const input = event.inputBuffer.getChannelData(0);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i] ?? 0));
      tap.pending[tap.pendingLength++] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    if (tap.pendingLength >= FLUSH_SAMPLES) flush(tap);
  };

  active = tap;
  attachSource(tap);
  // LiveKit may republish the mic (device change, restart) — follow it.
  room.on(RoomEvent.LocalTrackPublished, tap.onLocalTrackPublished);
  if (context.state === 'suspended') void context.resume();
}

function teardown(tap: ActiveTap): void {
  tap.room.off(RoomEvent.LocalTrackPublished, tap.onLocalTrackPublished);
  tap.processor.onaudioprocess = null;
  try {
    tap.source?.disconnect();
    tap.processor.disconnect();
    tap.sink.disconnect();
  } catch {
    /* ignore */
  }
  void tap.context.close().catch(() => undefined);
  if (active === tap) active = null;
}

/** Discard the current tap without diarizing (recording failed). */
export function abortLocalSpeakerTap(): void {
  if (!active) return;
  const tap = active;
  teardown(tap);
  window.electronAPI?.speakerDiarization?.abortSession(tap.sessionId);
}

/**
 * Stop tapping and diarize what was captured. Resolves to null when nothing was
 * being tapped or diarization failed (already logged). May take a while for
 * long recordings — the caller should not block the UI on it.
 */
export async function stopLocalSpeakerTap(): Promise<LocalSpeakerTapResult | null> {
  if (!active) return null;
  const tap = active;
  flush(tap);
  teardown(tap);

  const api = window.electronAPI?.speakerDiarization;
  if (!api || tap.startedAt === null) {
    api?.abortSession(tap.sessionId);
    return null;
  }

  const response = await api.finishSession(tap.sessionId);
  if (!response.ok || !response.result) {
    logger.error(Event.RECORDING_ERROR, {
      error: `speaker diarization failed: ${response.error ?? 'unknown error'}`,
    });
    return null;
  }
  return {
    recordingStartedAt: tap.startedAt,
    durationSeconds: response.result.durationSeconds,
    sampleRate: response.result.sampleRate,
    segments: response.result.segments,
  };
}
