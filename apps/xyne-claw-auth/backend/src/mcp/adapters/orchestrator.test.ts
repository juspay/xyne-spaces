import { describe, expect, it } from "vitest";
import { ORCHESTRATOR_TOOLS } from "./orchestrator.js";

describe("orchestrator tools", () => {
  it("exposes immediate perform_agent_call without proposal-only input", () => {
    expect(ORCHESTRATOR_TOOLS).toHaveLength(1);
    expect(ORCHESTRATOR_TOOLS[0]).toMatchObject({
      name: "perform_agent_call",
      selectionKey: "perform_agent_call",
      inputSchema: { required: ["agentSlug", "task"] },
    });
    expect(ORCHESTRATOR_TOOLS[0]?.inputSchema.properties).not.toHaveProperty("why");
  });
});
