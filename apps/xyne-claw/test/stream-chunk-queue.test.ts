import { describe, expect, it } from "vitest";
import { createChunkSender, type OutgoingStreamChunk } from "../src/stream-chunk-queue.js";

/** A destination whose POSTs finish when the test says so. */
function rig(): {
  sent: Array<{ destination: string; body: OutgoingStreamChunk }>;
  settle: (index: number, outcome?: "ok" | "fail") => void;
  sender: ReturnType<typeof createChunkSender>;
  tick: () => Promise<void>;
} {
  const sent: Array<{ destination: string; body: OutgoingStreamChunk }> = [];
  const settlers: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];
  const sender = createChunkSender((destination, body) => {
    sent.push({ destination, body });
    return new Promise<void>((resolve, reject) => settlers.push({ resolve, reject }));
  });
  return {
    sent,
    sender,
    settle: (index, outcome = "ok") => {
      const s = settlers[index];
      if (!s) throw new Error(`no POST #${index}`);
      if (outcome === "ok") s.resolve();
      else s.reject(new Error("boom"));
    },
    tick: () => new Promise((r) => setTimeout(r, 0)),
  };
}

const URL = "http://claw-auth/progress";

describe("createChunkSender", () => {
  it("sends the first delta at once and joins the ones produced while it is out", async () => {
    const r = rig();
    r.sender.push(URL, "s1", { reasoningDelta: "Let me" });
    r.sender.push(URL, "s1", { reasoningDelta: " parse" });
    r.sender.push(URL, "s1", { reasoningDelta: ":\n\n- " });
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]?.body).toEqual({ sessionId: "s1", reasoningDelta: "Let me" });

    r.settle(0);
    await r.tick();
    expect(r.sent).toHaveLength(2);
    expect(r.sent[1]?.body).toEqual({ sessionId: "s1", reasoningDelta: " parse:\n\n- " });

    r.settle(1);
    await r.tick();
    expect(r.sent).toHaveLength(2);
  });

  it("keeps reasoning and text apart inside one POST", async () => {
    const r = rig();
    r.sender.push(URL, "s1", { textDelta: "Here" });
    r.sender.push(URL, "s1", { reasoningDelta: "hmm" });
    r.sender.push(URL, "s1", { textDelta: " is" });
    r.settle(0);
    await r.tick();
    expect(r.sent[1]?.body).toEqual({ sessionId: "s1", reasoningDelta: "hmm", textDelta: " is" });
  });

  it("goes on after a failed POST", async () => {
    const r = rig();
    r.sender.push(URL, "s1", { textDelta: "a" });
    r.sender.push(URL, "s1", { textDelta: "b" });
    r.settle(0, "fail");
    await r.tick();
    expect(r.sent.map((s) => s.body.textDelta)).toEqual(["a", "b"]);
  });

  it("runs sessions and destinations side by side", async () => {
    const r = rig();
    r.sender.push(URL, "s1", { textDelta: "a" });
    r.sender.push(URL, "s2", { textDelta: "x" });
    r.sender.push("http://other/progress", "s1", { textDelta: "q" });
    expect(r.sent.map((s) => `${s.destination} ${s.body.sessionId} ${s.body.textDelta}`)).toEqual([
      `${URL} s1 a`,
      `${URL} s2 x`,
      "http://other/progress s1 q",
    ]);
  });

  it("starts a fresh POST once the queue has drained", async () => {
    const r = rig();
    r.sender.push(URL, "s1", { textDelta: "a" });
    r.settle(0);
    await r.tick();
    r.sender.push(URL, "s1", { textDelta: "b" });
    expect(r.sent).toHaveLength(2);
    expect(r.sent[1]?.body).toEqual({ sessionId: "s1", textDelta: "b" });
  });

  it("ignores empty deltas", () => {
    const r = rig();
    r.sender.push(URL, "s1", {});
    r.sender.push(URL, "s1", { textDelta: "" });
    expect(r.sent).toHaveLength(0);
  });
});
