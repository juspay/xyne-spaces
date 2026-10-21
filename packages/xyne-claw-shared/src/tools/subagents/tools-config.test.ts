import { describe, expect, it } from "vitest";
import { isEmptyToolsSelection, resolveAgentToolsConfig } from "./definitions.js";

describe("resolveAgentToolsConfig — what a run enforces", () => {
  it("gives a standard agent with nothing selected an empty selection, not everything", () => {
    expect(resolveAgentToolsConfig({}, "standard")).toEqual({});
    expect(resolveAgentToolsConfig(undefined, "standard")).toEqual({});
    expect(resolveAgentToolsConfig({ toolPermissions: { x: "ask" } }, null)).toEqual({});
  });

  it("leaves an orchestrator with nothing selected unrestricted", () => {
    expect(resolveAgentToolsConfig({}, "orchestrator")).toBeUndefined();
    expect(resolveAgentToolsConfig(null, "orchestrator")).toBeUndefined();
  });

  it("reads a saved all-empty selection the same as no selection", () => {
    const empty = { tools: { subagents: [], direct: [], custom: [] } };
    expect(resolveAgentToolsConfig(empty, "orchestrator")).toBeUndefined();
    expect(resolveAgentToolsConfig(empty, "standard")).toEqual({ subagents: [], direct: [], custom: [] });
  });

  it("enforces a real selection as-is for every tier", () => {
    const tools = { subagents: ["grafana"], direct: ["spaces-whoami"] };
    expect(resolveAgentToolsConfig({ tools }, "standard")).toBe(tools);
    expect(resolveAgentToolsConfig({ tools }, "orchestrator")).toBe(tools);
  });

  it("treats an open palette on its own as a selection", () => {
    const tools = { openPalette: "read" };
    expect(resolveAgentToolsConfig({ tools }, "orchestrator")).toBe(tools);
  });
});

describe("isEmptyToolsSelection", () => {
  it("is true only when nothing is listed and the palette is closed", () => {
    expect(isEmptyToolsSelection({})).toBe(true);
    expect(isEmptyToolsSelection({ subagents: [], direct: [], custom: [], gateway: [] })).toBe(true);
    expect(isEmptyToolsSelection({ custom: ["web-search"] })).toBe(false);
    expect(isEmptyToolsSelection({ callableAgents: ["x"] } as never)).toBe(false);
    expect(isEmptyToolsSelection({ openPalette: "all" } as never)).toBe(false);
    expect(isEmptyToolsSelection({ openPalette: "off" } as never)).toBe(true);
  });
});
