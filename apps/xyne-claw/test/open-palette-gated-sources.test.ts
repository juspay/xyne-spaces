import { describe, expect, it } from "vitest";
import { loadCustomTools } from "../src/custom-tools.js";
import { classifyToolRisk } from "xyne-claw-shared";

/**
 * The open palette exists to "let an agent reach tools nobody granted it".
 *
 * `loadCustomTools` used to drop whole agent-gated sources (custom:sandbox,
 * custom:research-agent, custom:generate-image) one layer ABOVE the palette, so
 * the palette had nothing left to admit: an agent with `openPalette: "all"` saw
 * exactly what `"off"` saw, and `load-tools sandbox-read-file` answered
 * "Unknown" for a source the deployment ships. Prod symptom: the catalog
 * advertised 207 tools across 31 sources, custom:sandbox absent, and the model
 * concluded the tools were granted only to other agents.
 */
const names = (tools: { name: string }[]) => new Set(tools.map((t) => t.name));

function load(openPalette: "off" | "read" | "all", custom: string[] = []) {
  return loadCustomTools(
    { tools: { openPalette, custom } } as Record<string, unknown>,
    { agentSlug: "probe-agent", userId: "u1" },
  ).tools;
}

describe("open palette reaches agent-gated custom sources", () => {
  it("does NOT surface sandbox tools when the palette is off", () => {
    const n = names(load("off"));
    expect(n.has("sandbox-read-file")).toBe(false);
    expect(n.has("sandbox-create")).toBe(false);
  });

  it("surfaces sandbox tools when the palette is on but no sandbox slug is selected", () => {
    const n = names(load("all"));
    expect(n.has("sandbox-read-file")).toBe(true);
    expect(n.has("sandbox-create")).toBe(true);
    expect(n.has("sandbox-run")).toBe(true);
  });

  it("keeps the selection path working unchanged", () => {
    const n = names(load("off", ["sandbox-create"]));
    expect(n.has("sandbox-read-file")).toBe(true);
  });

  it("never surfaces hard-excluded sources, palette or not", () => {
    // These are correctness rules (claw-auth executes them; loading them
    // in-process would duplicate tool names), not grants.
    for (const mode of ["off", "all"] as const) {
      const sources = new Set(
        load(mode).map((t) => (t as { source?: string }).source ?? ""),
      );
      expect(sources.has("custom:google")).toBe(false);
      expect(sources.has("custom:microsoft")).toBe(false);
      expect(sources.has("custom:orchestrator")).toBe(false);
      expect(sources.has("custom:webfetch")).toBe(false);
    }
  });
});

/**
 * `isWriteTool` is tri-state: `false` is a CLAIM of read-only that
 * classifyToolRisk trusts, `undefined` means nothing knows. Flattening
 * undefined to false made every undeclared custom tool look like a read tool,
 * which would have let `openPalette: "read"` admit sandbox-write-file.
 */
describe("undeclared custom tools do not claim to be read-only", () => {
  it("classifies write-shaped sandbox tools as writes", () => {
    const tools = load("all");
    const byName = new Map(tools.map((t) => [t.name, t as { isWriteTool?: boolean }]));
    for (const name of ["sandbox-write-file", "sandbox-edit-file", "sandbox-create"]) {
      const tool = byName.get(name);
      expect(tool, name).toBeDefined();
      expect(tool!.isWriteTool, name).toBeUndefined();
      expect(classifyToolRisk(name, tool!.isWriteTool), name).toBe("write");
    }
  });

  it("still classifies sandbox-destroy as destructive", () => {
    const tool = load("all").find((t) => t.name === "sandbox-destroy") as { isWriteTool?: boolean };
    expect(classifyToolRisk("sandbox-destroy", tool.isWriteTool)).toBe("destructive");
  });

  it("preserves an explicit read-only declaration", () => {
    const tool = load("all").find((t) => t.name === "postman-sbx-run-collection") as
      | { isWriteTool?: boolean }
      | undefined;
    if (tool) expect(tool.isWriteTool).toBe(false);
  });
});
