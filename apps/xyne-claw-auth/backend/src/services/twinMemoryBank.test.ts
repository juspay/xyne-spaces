import { beforeEach, describe, expect, it, vi } from "vitest";

const provider = vi.hoisted(() => ({
  ensureBank: vi.fn(),
  retain: vi.fn(),
  listMemories: vi.fn(),
}));

vi.mock("xyne-claw-shared", async (orig) => ({
  ...(await orig<typeof import("xyne-claw-shared")>()),
  getMemoryProvider: () => provider,
}));

import { bankIdForAgent, DIGITAL_TWIN_BANK_ID } from "xyne-claw-shared";
import {
  ensureTwinBank,
  listUserTwinMemories,
  pickEventTimestamp,
  retainTwinMemory,
  subsystemOfTags,
  twinObservationScopes,
  VERBATIM_IMPORT_STRATEGY,
} from "./twinMemoryBank.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("twin bank id", () => {
  it("is the digital-twin agent's bank", () => {
    expect(DIGITAL_TWIN_BANK_ID).toBe(bankIdForAgent("digital-twin"));
    expect(DIGITAL_TWIN_BANK_ID).toBe("xyne-digital-twin");
  });
});

describe("ensureTwinBank", () => {
  it("enables observations and registers the verbatim-import strategy", async () => {
    provider.ensureBank.mockResolvedValue(undefined);
    await ensureTwinBank();
    expect(provider.ensureBank).toHaveBeenCalledWith(DIGITAL_TWIN_BANK_ID, {
      enableObservations: true,
      retainStrategies: {
        [VERBATIM_IMPORT_STRATEGY]: { retain_extraction_mode: "chunks", retain_chunk_size: 8_000 },
      },
    });
  });

  it("swallows a provider failure (best-effort)", async () => {
    provider.ensureBank.mockRejectedValue(new Error("boom"));
    await expect(ensureTwinBank()).resolves.toBeUndefined();
  });
});

describe("pickEventTimestamp / twinObservationScopes", () => {
  it("picks the latest valid source timestamp as ISO", () => {
    expect(
      pickEventTimestamp([{ ts: "2026-01-01T00:00:00Z" }, { ts: "2026-03-01T00:00:00Z" }, { ts: "nope" }, null]),
    ).toBe("2026-03-01T00:00:00.000Z");
    expect(pickEventTimestamp([])).toBeUndefined();
    expect(pickEventTimestamp("x")).toBeUndefined();
  });

  it("confines observations to the one user", () => {
    expect(twinObservationScopes("u1")).toEqual([["user:u1"]]);
  });
});

describe("retainTwinMemory", () => {
  const base = { userId: "u1", subsystem: "style", content: "Writes short replies", sourceRefs: [] as unknown };

  it("tags user, subsystem, scope and (when present) the pipeline event, in that order", async () => {
    provider.retain.mockResolvedValue([{ id: "m1" }]);
    const id = await retainTwinMemory({ ...base, pipelineEventId: "evt1" });
    expect(id).toBe("m1");
    expect(provider.retain).toHaveBeenCalledWith(DIGITAL_TWIN_BANK_ID, [
      {
        content: "Writes short replies",
        tags: ["user:u1", "subsystem:style", "scope:user", "pipeline:evt1"],
        observationScopes: [["user:u1"]],
      },
    ]);
  });

  it("omits the pipeline tag without an event id", async () => {
    provider.retain.mockResolvedValue([{ id: "m1" }]);
    await retainTwinMemory({ ...base, pipelineEventId: null });
    expect(provider.retain.mock.calls[0]![1][0].tags).toEqual(["user:u1", "subsystem:style", "scope:user"]);
  });

  it("passes a timestamp only when a source ref carries one", async () => {
    provider.retain.mockResolvedValue([{ id: "m1" }]);
    await retainTwinMemory({ ...base, pipelineEventId: null });
    expect(provider.retain.mock.calls[0]![1][0]).not.toHaveProperty("timestamp");

    await retainTwinMemory({
      ...base,
      sourceRefs: [{ ts: "2026-01-01T00:00:00Z" }, { ts: "2026-02-01T00:00:00Z" }],
      pipelineEventId: null,
    });
    expect(provider.retain.mock.calls[1]![1][0].timestamp).toBe("2026-02-01T00:00:00.000Z");
  });

  it("returns null when the provider gives back no id", async () => {
    provider.retain.mockResolvedValue([]);
    expect(await retainTwinMemory({ ...base, pipelineEventId: null })).toBeNull();
    provider.retain.mockResolvedValue(undefined);
    expect(await retainTwinMemory({ ...base, pipelineEventId: null })).toBeNull();
  });

  it("does not ensure the bank and lets a retain failure propagate", async () => {
    provider.retain.mockRejectedValue(new Error("retain down"));
    await expect(retainTwinMemory({ ...base, pipelineEventId: null })).rejects.toThrow("retain down");
    expect(provider.ensureBank).not.toHaveBeenCalled();
  });
});

describe("listUserTwinMemories", () => {
  it("queries by the user tag and drops memories Hindsight over-matched", async () => {
    provider.listMemories.mockResolvedValue({
      memories: [
        { id: "a", content: "mine", tags: ["user:u1", "subsystem:style"] },
        { id: "b", content: "theirs", tags: ["user:u2", "subsystem:style"] },
        { id: "c", content: "untagged" },
      ],
    });
    const out = await listUserTwinMemories("u1", 500);
    expect(provider.listMemories).toHaveBeenCalledWith(DIGITAL_TWIN_BANK_ID, { tags: ["user:u1"], limit: 500 });
    expect(out.map((m) => m.id)).toEqual(["a"]);
  });
});

describe("subsystemOfTags", () => {
  it("reads the subsystem name off its tag", () => {
    expect(subsystemOfTags(["user:u1", "subsystem:style", "scope:user"])).toBe("style");
  });

  it("is undefined without a subsystem tag or tags", () => {
    expect(subsystemOfTags(["user:u1"])).toBeUndefined();
    expect(subsystemOfTags(undefined)).toBeUndefined();
  });
});
