import { describe, expect, it } from "vitest";
import { SpeakerRouter, type AudioSink, type Speaker } from "../src/speakerRouter.js";

class Sink implements AudioSink {
  usable = true;
  chunks: number[] = [];
  closed = false;
  push(samples: Int16Array) {
    this.chunks.push(samples[0]!);
  }
  async close() {
    this.closed = true;
  }
}

const rahul: Speaker = { key: "p1", name: "Rahul" };
const priya: Speaker = { key: "p2", name: "Priya" };
// Each chunk's first sample is its sequence number, so tests can see where it went.
const chunk = (n: number) => new Int16Array([n]);

function setup(lag = 2) {
  const fallback = new Sink();
  const sinks = new Map<string, Sink>();
  const router = new SpeakerRouter("s", fallback, (speaker) => {
    const sink = new Sink();
    sinks.set(speaker.name, sink);
    return sink;
  }, lag);
  return { router, fallback, sinks };
}

describe("SpeakerRouter", () => {
  it("holds audio from before anyone speaks and gives it to the first speaker", () => {
    const { router, fallback, sinks } = setup(1);
    for (let i = 0; i < 4; i++) router.push(chunk(i), null);
    expect(fallback.chunks).toEqual([]);
    router.push(chunk(4), rahul);
    expect(sinks.get("Rahul")?.chunks).toEqual([0, 1, 2, 3]);
  });

  it("gives up holding after a while and uses the fallback", () => {
    const { router, fallback } = setup(0);
    for (let i = 0; i < 61; i++) router.push(chunk(i), null);
    expect(fallback.chunks).toEqual([0]);
  });

  it("credits a chunk to whoever Meet shows speaking a little later", () => {
    const { router, sinks, fallback } = setup(2);
    // Rahul starts talking at chunk 0, but Meet only shows him from chunk 2.
    router.push(chunk(0), null);
    router.push(chunk(1), null);
    router.push(chunk(2), rahul);
    router.push(chunk(3), rahul);
    expect(sinks.get("Rahul")?.chunks).toEqual([0, 1]);
    expect(fallback.chunks).toEqual([]);
  });

  it("keeps pauses with the last speaker and switches on a new speaker", () => {
    const { router, sinks } = setup(1);
    router.push(chunk(0), rahul);
    router.push(chunk(1), null); // pause: still Rahul
    router.push(chunk(2), priya);
    router.push(chunk(3), priya);
    expect(sinks.get("Rahul")?.chunks).toEqual([0]);
    expect(sinks.get("Priya")?.chunks).toEqual([1, 2]);
  });

  it("falls back when a speaker's participant can't be used", () => {
    const fallback = new Sink();
    const broken = new Sink();
    broken.usable = false;
    const router = new SpeakerRouter("s", fallback, () => broken, 0);
    router.push(chunk(7), rahul);
    expect(fallback.chunks).toEqual([7]);
  });

  it("flushes buffered audio and closes every speaker on close", async () => {
    const { router, sinks } = setup(3);
    router.push(chunk(0), rahul);
    router.push(chunk(1), rahul);
    await router.close();
    expect(sinks.get("Rahul")?.chunks).toEqual([0, 1]);
    expect(sinks.get("Rahul")?.closed).toBe(true);
  });
});
