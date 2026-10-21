import { beforeEach, describe, expect, it, vi } from "vitest";

// Every approved fact lands in "style" → soul.md (subsystems style/context/triage).
vi.mock("xyne-claw-shared", async (orig) => ({
  ...(await orig<typeof import("xyne-claw-shared")>()),
  getMemoryProvider: () => ({
    listMemories: async () => ({
      memories: [{ content: "Writes short replies", tags: ["user:u1", "subsystem:style"] }],
    }),
  }),
}));

const upsertFile = vi.fn(async () => undefined);
vi.mock("./agentMemoryFiles.js", async (orig) => ({
  ...(await orig<typeof import("./agentMemoryFiles.js")>()),
  getFile: async () => ({ content: "# Soul\nold", updatedBy: "synthesizer" }),
  upsertFile: (...a: unknown[]) => upsertFile(...(a as [])),
}));

const finishSynthesisEvent = vi.fn(async () => undefined);
vi.mock("./digitalTwinPipelineEvents.js", () => ({
  startSynthesisEvent: async () => "evt1",
  finishSynthesisEvent: (...a: unknown[]) => finishSynthesisEvent(...(a as [])),
}));

process.env["XYNE_CLAW_S2S_KEY"] ??= "test-s2s";
process.env["XYNE_CLAW_URL"] ??= "http://claw.test";
const { synthesizeSoulFilesForUser } = await import("./twinSoulSynthesizer.js");

function clawReplies(check: unknown) {
  const bodies: Array<Record<string, unknown>> = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ success: true, content: "# Soul\nnew", ...(check ? { check } : {}) }), { status: 200 });
  });
  return bodies;
}

beforeEach(() => {
  upsertFile.mockClear();
  finishSynthesisEvent.mockClear();
});

describe("nightly persona rewrite check (R10)", () => {
  it("daily runs ask for the check; a rejected rewrite keeps the old file", async () => {
    const bodies = clawReplies({ verdict: "reject", keepsOld: 0.01, supported: 0.02, source: "jev", ms: 500 });
    const r = await synthesizeSoulFilesForUser("u1", "daily");
    expect(bodies[0]!["check"]).toBe(true);
    expect(upsertFile).not.toHaveBeenCalled();
    expect(r.updated).toEqual([]);
    const files = (finishSynthesisEvent.mock.calls[0] as unknown as [string, string, { files: Array<{ name: string; action: string }> }])[2].files;
    expect(files.find((f) => f.name === "soul.md")).toMatchObject({ action: "held" });
  });

  it("a 'review' verdict still writes (holding on unsure would freeze the file)", async () => {
    clawReplies({ verdict: "review", keepsOld: 0.6, supported: 0.45, source: "jev", ms: 400 });
    const r = await synthesizeSoulFilesForUser("u1", "daily");
    expect(r.updated).toEqual(["soul.md"]);
  });

  it("an accepted rewrite is written", async () => {
    clawReplies({ verdict: "accept", keepsOld: 0.9, supported: 0.9, source: "jev", ms: 400 });
    const r = await synthesizeSoulFilesForUser("u1", "daily");
    expect(upsertFile).toHaveBeenCalledTimes(1);
    expect(r.updated).toEqual(["soul.md"]);
  });

  it("manual runs do not ask for the check and write as before", async () => {
    const bodies = clawReplies(null);
    const r = await synthesizeSoulFilesForUser("u1", "manual");
    expect(bodies[0]!["check"]).toBeUndefined();
    expect(r.updated).toEqual(["soul.md"]);
  });

  it("no verdict from claw (classifier down / old claw) → written as before", async () => {
    clawReplies(null);
    const r = await synthesizeSoulFilesForUser("u1", "daily");
    expect(r.updated).toEqual(["soul.md"]);
  });

  it("a claw error is persisted as an 'error' result: name, trace keys, action, error", async () => {
    const trace = { model: "m", durationMs: 5, factsUsed: 1 };
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ success: false, content: null, error: "x", trace }), { status: 200 }));
    const r = await synthesizeSoulFilesForUser("u1", "daily");
    expect(r.skipped).toContain("soul.md");
    expect(upsertFile).not.toHaveBeenCalled();
    const files = (finishSynthesisEvent.mock.calls[0] as unknown as [string, string, { files: Array<{ name: string }> }])[2].files;
    const soul = files.find((f) => f.name === "soul.md");
    expect(Object.keys(soul!)).toEqual(["name", "model", "durationMs", "factsUsed", "action", "error"]);
    expect(soul).toMatchObject({ action: "error", error: "x", factsUsed: 1 });
  });
});
