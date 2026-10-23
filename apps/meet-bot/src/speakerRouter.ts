import { log } from "./log.js";

/** A Meet participant, as identified by their tile (see inpage/meet-capture.js). */
export interface Speaker {
  /** Meet's participant id: stable for the meeting. */
  key: string;
  name: string;
}

/** What the router needs from a LiveKit publisher (LivekitPublisher in production). */
export interface AudioSink {
  readonly usable: boolean;
  push(samples: Int16Array): void;
  close(): Promise<void>;
}

// Meet's talking animation trails the audio by ~0.3 s; each chunk is ~85 ms, so a
// chunk is credited to whoever Meet shows as speaking 3 chunks later.
const DEFAULT_LAG_CHUNKS = 3;
// Beyond this many speakers, audio goes to the default participant.
const MAX_SPEAKERS = 25;
// Audio from before anyone is seen speaking is held (up to ~5 s) and credited to
// the first speaker, instead of being labelled "Google Meet".
const MAX_HELD_CHUNKS = 60;

/**
 * Routes the meeting's mixed audio to one LiveKit participant per speaker, so the
 * transcription agent labels each line with the speaker's name. Audio from before
 * anyone is seen speaking is held and credited to the first speaker (the default
 * "Google Meet" participant only gets it if nobody is seen for a while); silence
 * between turns stays with whoever spoke last.
 */
export class SpeakerRouter {
  private readonly sinks = new Map<string, AudioSink>();
  private readonly pending: Array<{ samples: Int16Array; speaker: Speaker | null }> = [];
  private lastSpeaker: Speaker | null = null;
  private held: Int16Array[] = [];

  constructor(
    private readonly sessionId: string,
    private readonly fallback: AudioSink,
    private readonly openSink: (speaker: Speaker) => AudioSink,
    private readonly lagChunks = DEFAULT_LAG_CHUNKS,
  ) {}

  push(samples: Int16Array, speaker: Speaker | null): void {
    this.pending.push({ samples, speaker });
    while (this.pending.length > this.lagChunks) {
      const chunk = this.pending.shift()!;
      const later = this.pending.at(-1)?.speaker ?? null;
      this.route(chunk.samples, later ?? chunk.speaker);
    }
  }

  private route(samples: Int16Array, speaker: Speaker | null): void {
    if (speaker) this.lastSpeaker = speaker;
    if (!this.lastSpeaker) {
      this.held.push(samples);
      if (this.held.length > MAX_HELD_CHUNKS) this.fallback.push(this.held.shift()!);
      return;
    }
    const target = this.sinkFor(this.lastSpeaker);
    const sink = target.usable ? target : this.fallback;
    for (const chunk of this.held.splice(0)) sink.push(chunk);
    sink.push(samples);
  }

  private sinkFor(speaker: Speaker): AudioSink {
    const existing = this.sinks.get(speaker.key);
    if (existing) return existing;
    if (this.sinks.size >= MAX_SPEAKERS) return this.fallback;
    log.info("speaker_joined_transcript", { sessionId: this.sessionId, speaker: speaker.name });
    const sink = this.openSink(speaker);
    this.sinks.set(speaker.key, sink);
    return sink;
  }

  async close(): Promise<void> {
    for (const chunk of this.pending.splice(0)) this.route(chunk.samples, chunk.speaker);
    for (const chunk of this.held.splice(0)) this.fallback.push(chunk);
    await Promise.all([...this.sinks.values()].map((sink) => sink.close()));
  }
}
