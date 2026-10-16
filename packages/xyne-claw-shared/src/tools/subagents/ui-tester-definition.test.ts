import { describe, expect, it } from "vitest";
import { findSubagentDefinitionForServer, getSubagentDefinition } from "./definitions.js";

describe("ui-tester subagent definition", () => {
  it("wraps the custom:ui-tester tools", () => {
    const def = findSubagentDefinitionForServer("custom:ui-tester");
    expect(def?.name).toBe("ui-tester");
    expect(getSubagentDefinition("ui-tester")?.serverType).toBe("custom:ui-tester");
  });

  it("tells the child to use the batch tool and return a short evidence table", () => {
    const def = getSubagentDefinition("ui-tester")!;
    expect(def.systemPrompt).toContain("ui-test-variations");
    expect(def.systemPrompt).toContain("never edit the application's source");
    expect(def.systemPrompt).toMatch(/variation \| verdict \| evidence/);
    expect(def.thinkingLevel).toBe("low");
  });
});
