import {
  AudioFrame,
  AudioSource,
  LocalAudioTrack,
  Room,
  RoomEvent,
  TrackPublishOptions,
  TrackSource,
} from "@livekit/rtc-node";
import { log } from "./log.js";

/** Sample rate of the PCM the meeting page sends (see inpage/meeting-capture.js). */
export const CAPTURE_SAMPLE_RATE = 48_000;
// LiveKit takes audio in 10 ms frames.
const FRAME_SAMPLES = CAPTURE_SAMPLE_RATE / 100;

/**
 * One LiveKit participant publishing audio from Node, with LiveKit's native SDK.
 * (livekit-client can't run inside Meet's page: Meet locks down the browser objects
 * it needs.) Audio pushed before the connection is up is queued, not dropped.
 */
export class LivekitPublisher {
  private readonly room = new Room();
  private readonly source = new AudioSource(CAPTURE_SAMPLE_RATE, 1);
  private pending = new Int16Array(0);
  private queue: Promise<unknown> = Promise.resolve();
  private failed = false;
  disconnected = false;

  constructor(
    private readonly sessionId: string,
    readonly label: string,
  ) {
    this.room.on(RoomEvent.Disconnected, (reason) => {
      this.disconnected = true;
      log.warn("livekit_disconnected", { sessionId, participant: label, reason: String(reason) });
    });
  }

  /** Connects and publishes the audio track; `credentials` is awaited inside the queue. */
  connect(credentials: () => Promise<{ livekitUrl: string; token: string }>): Promise<void> {
    const connected = this.queue.then(async () => {
      const { livekitUrl, token } = await credentials();
      await this.room.connect(livekitUrl, token, { autoSubscribe: false, dynacast: false });
      const track = LocalAudioTrack.createAudioTrack("google-meet", this.source);
      await this.room.localParticipant!.publishTrack(
        track,
        new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }),
      );
      log.info("livekit_publishing", { sessionId: this.sessionId, participant: this.label, room: this.room.name });
    });
    this.queue = connected.catch((error: unknown) => {
      this.failed = true;
      log.warn("livekit_connect_failed", { sessionId: this.sessionId, participant: this.label, error: String(error) });
    });
    return connected;
  }

  get usable(): boolean {
    return !this.failed && !this.disconnected;
  }

  /** Queues 16-bit mono PCM at CAPTURE_SAMPLE_RATE, sent on in 10 ms frames. */
  push(samples: Int16Array): void {
    if (!this.usable) return;
    const all = new Int16Array(this.pending.length + samples.length);
    all.set(this.pending);
    all.set(samples, this.pending.length);
    let offset = 0;
    for (; offset + FRAME_SAMPLES <= all.length; offset += FRAME_SAMPLES) {
      const frame = new AudioFrame(all.slice(offset, offset + FRAME_SAMPLES), CAPTURE_SAMPLE_RATE, 1, FRAME_SAMPLES);
      this.queue = this.queue
        .then(() => (this.usable ? this.source.captureFrame(frame) : undefined))
        .catch((error: unknown) =>
          log.warn("livekit_capture_failed", { sessionId: this.sessionId, participant: this.label, error: String(error) }),
        );
    }
    this.pending = all.slice(offset);
  }

  async close(): Promise<void> {
    await this.queue;
    await this.room.disconnect().catch(() => undefined);
    await this.source.close().catch(() => undefined);
  }
}

/** Decodes the base64 little-endian PCM the page sends. */
export function decodePcm(base64: string): Int16Array {
  const bytes = Buffer.from(base64, "base64");
  return new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.length / 2)).slice();
}
