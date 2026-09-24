import { describe, expect, it, vi } from "vitest";

vi.mock("../../repositories/index.js", () => ({ evalRepository: {}, agentRepository: {} }));
vi.mock("../../queue/eval-generation-queue.js", () => ({
  enqueueEvalGeneration: vi.fn(),
  getEvalGenerationStatus: vi.fn(),
  cancelEvalGeneration: vi.fn(),
}));

const { armDisplayModel, parseAgentSpecs } = await import("./generations.js");

describe("eval generation arms", () => {
  it("lets one agent be compared against itself with different switches", () => {
    const parsed = parseAgentSpecs({
      agents: [
        { agentSlug: "xyne", optimizations: "none" },
        { agentSlug: "xyne", optimizations: "all" },
        { agentSlug: "xyne", optimizations: "all" },
      ],
    });
    expect("specs" in parsed && parsed.specs.map((s) => s.optimizations)).toEqual(["none", "all"]);
  });

  it("still dedupes the same agent when the arms are identical", () => {
    const parsed = parseAgentSpecs({ agents: [{ agentSlug: "xyne" }, { agentSlug: "xyne" }] });
    expect("specs" in parsed && parsed.specs).toHaveLength(1);
  });

  it("drops malformed switch specs instead of forwarding them", () => {
    const parsed = parseAgentSpecs({ agentSlug: "xyne", optimizations: "all; rm -rf /", judgeBackend: "jev!!" });
    expect("specs" in parsed && parsed.specs[0]).toMatchObject({ optimizations: null, judgeBackend: null });
  });

  it("labels the arm for display without touching the real model", () => {
    expect(armDisplayModel({ genModel: null, optimizations: null, judgeBackend: null })).toBeNull();
    expect(armDisplayModel({ genModel: "kimi-latest", optimizations: null, judgeBackend: null })).toBe("kimi-latest");
    expect(armDisplayModel({ genModel: null, optimizations: "none", judgeBackend: null })).toBe("default · opts:none");
    expect(armDisplayModel({ genModel: "kimi-latest", optimizations: "all,-jev_compaction", judgeBackend: "ourtrainedjev" }))
      .toBe("kimi-latest · opts:all,-jev_compaction · judge:ourtrainedjev");
  });
});
