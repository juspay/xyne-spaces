import { describe, expect, it } from "vitest";
import { classifyToolRisk } from "../tool-risk.js";
import { openPaletteAdmits } from "../open-palette.js";
import {
  AGENT_INTROSPECT_TOOL_DEFS,
  FIND_METRIC_SESSIONS_KINDS,
  GET_AGENT_METRICS_SORTS,
  GET_AGENT_METRICS_VIEWS,
  findMetricSessionsTool,
  getAgentMetricsTool,
} from "./tools.js";

type Props = Record<string, { enum?: unknown[] }>;
const props = (d: { inputSchema: unknown }): Props => (d.inputSchema as { properties: Props }).properties;

describe("agent metrics tool definitions", () => {
  it.each([getAgentMetricsTool, findMetricSessionsTool].map((d) => [d.slug, d] as const))("%s is registered once, read-classified and bounded", (_slug, d) => {
    expect(AGENT_INTROSPECT_TOOL_DEFS.filter((x) => x.slug === d.slug)).toHaveLength(1);
    expect(classifyToolRisk(d.slug)).toBe("read");
    expect(openPaletteAdmits("read", d.slug)).toBe(true);
    expect(d.name).toBe(d.slug);
    expect(d.source).toBe("custom:agent-introspect");
    expect(d.description.length).toBeLessThan(1200);
    expect(d.description.trim().endsWith("Read-only.")).toBe(true);
  });

  it("exposes only the documented parameters", () => {
    expect(Object.keys(props(getAgentMetricsTool)).sort()).toEqual(
      ["agentSlug", "days", "includeSubagents", "limit", "sortBy", "tool", "view"].sort(),
    );
    expect(Object.keys(props(findMetricSessionsTool)).sort()).toEqual(["agentSlug", "cursor", "days", "kind", "limit", "tool"].sort());
    expect((findMetricSessionsTool.inputSchema as { required?: string[] }).required).toEqual(["kind"]);
  });

  it("schema enums are the exported constants", () => {
    expect(props(getAgentMetricsTool)["view"]?.enum).toEqual([...GET_AGENT_METRICS_VIEWS]);
    expect(props(getAgentMetricsTool)["sortBy"]?.enum).toEqual([...GET_AGENT_METRICS_SORTS]);
    expect(props(getAgentMetricsTool)["days"]?.enum).toEqual([1, 7, 30]);
    expect(props(findMetricSessionsTool)["kind"]?.enum).toEqual([...FIND_METRIC_SESSIONS_KINDS]);
  });
});
