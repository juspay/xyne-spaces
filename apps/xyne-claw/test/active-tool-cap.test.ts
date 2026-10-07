import { afterEach, describe, expect, it } from "vitest";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  ACTIVE_TOOL_CAP_DEFAULT,
  activeToolCap,
  demotedCatalogItem,
  demotedCatalogName,
  planActiveToolCap,
  readToolUsageRank,
} from "../src/active-tool-cap.js";
import { OPTIMIZATIONS } from "../src/optimizations.js";
import { buildFastModeMetaTools, renderToolCatalogForPrompt } from "../src/tool-catalog.js";

const wrappers = ["spaces", "github", "grafana", "bitbucket", "deepwiki", "context7", "task-status", "task-stop"];
const workflow = [
  "catalog", "create", "get", "list", "node_context", "run", "run_get", "run_list", "step_events", "update", "validate",
].map((n) => `Xyne_Workflows__workflow_${n}`);
const custom = [
  ...["click", "close", "console-messages", "evaluate", "navigate", "network-requests", "press-key", "screenshot", "snapshot", "type", "wait-for"].map((n) => `sandbox-pw-${n}`),
  "sandbox-create", "sandbox-deliver-files", "sandbox-destroy", "sandbox-poll-job", "sandbox-read-file", "sandbox-repo-setup",
  "sandbox-run", "sandbox-run-detached", "sandbox-write-file", "schedule-task", "send-attachment", "create-html-report",
  "web-search", "update-skill", "scheduled-job-control", "create-video-explainer", "webfetch", "ask-user-question",
  "create-mcp", "create-skill", "create-subagent", "update-agent", "update-subagent",
];
const architectActive = [...wrappers, ...workflow, ...custom];
const demotable = new Set([...workflow, ...custom]);
const pinned = new Set(["propose-plan", "emit_brief", "ask-user-question"]);
const usage = ["sandbox-run", "spaces", "sandbox-read-file", "webfetch", "Xyne_Workflows__workflow_get", "sandbox-repo-setup", "web-search", "github"];

describe("active tool cap planning", () => {
  it("brings Architect's palette down to the cap, keeping the tools it actually uses", () => {
    const plan = planActiveToolCap({ activeNames: architectActive, demotable, pinned, usageRank: usage, cap: 25, fixedExtra: 7 });
    expect(plan.outcome).toBe("capped");
    expect(plan.total).toBe(architectActive.length + 7);
    expect(plan.keep.length + 7).toBe(25);
    for (const used of ["sandbox-run", "sandbox-read-file", "webfetch", "Xyne_Workflows__workflow_get", "sandbox-repo-setup", "web-search"]) {
      expect(plan.keep).toContain(used);
    }
    expect(plan.demote).toContain("create-video-explainer");
    expect(plan.demote).toContain("sandbox-pw-press-key");
  });

  it("never demotes wrappers, task tools or pinned tools", () => {
    const plan = planActiveToolCap({ activeNames: architectActive, demotable, pinned, usageRank: usage, cap: 25, fixedExtra: 7 });
    for (const fixed of [...wrappers, "ask-user-question"]) expect(plan.keep).toContain(fixed);
    for (const fixed of [...wrappers, "ask-user-question"]) expect(plan.demote).not.toContain(fixed);
  });

  it("gives used tools the slots first and fills remaining room in configured order", () => {
    const plan = planActiveToolCap({ activeNames: architectActive, demotable, pinned, usageRank: ["webfetch", "sandbox-run"], cap: 25, fixedExtra: 7 });
    const keptDemotable = plan.keep.filter((n) => demotable.has(n) && !pinned.has(n));
    expect(keptDemotable).toHaveLength(plan.budget);
    expect(keptDemotable).toEqual(expect.arrayContaining(["webfetch", "sandbox-run"]));
    expect(keptDemotable.filter((n) => n !== "webfetch" && n !== "sandbox-run")).toEqual(workflow.slice(0, plan.budget - 2));
    expect(plan.keep.length + plan.demote.length).toBe(architectActive.length);
  });

  it("keeps a used tool over an unused one when only one slot is left", () => {
    const plan = planActiveToolCap({ activeNames: [...wrappers, ...workflow, "webfetch"], demotable, pinned, usageRank: ["webfetch"], cap: wrappers.length + 7 + 1, fixedExtra: 7 });
    expect(plan.budget).toBe(1);
    expect(plan.keep.filter((n) => demotable.has(n))).toEqual(["webfetch"]);
  });

  it("changes nothing for an agent already under the cap", () => {
    const plan = planActiveToolCap({ activeNames: wrappers.concat(workflow.slice(0, 3)), demotable, pinned, usageRank: usage, cap: 25, fixedExtra: 7 });
    expect(plan.outcome).toBe("under-cap");
    expect(plan.demote).toEqual([]);
  });

  it("changes nothing when there is no usage history to rank by", () => {
    const plan = planActiveToolCap({ activeNames: architectActive, demotable, pinned, usageRank: [], cap: 25, fixedExtra: 7 });
    expect(plan.outcome).toBe("no-usage");
    expect(plan.demote).toEqual([]);
  });

  it("demotes every demotable tool when fixed tools already fill the cap", () => {
    const plan = planActiveToolCap({ activeNames: architectActive, demotable, pinned, usageRank: usage, cap: 12, fixedExtra: 7 });
    expect(plan.budget).toBe(0);
    expect(plan.keep.sort()).toEqual([...wrappers, "ask-user-question"].sort());
  });
});

describe("cap and usage inputs", () => {
  const saved = process.env["XYNE_ACTIVE_TOOL_CAP"];
  afterEach(() => {
    if (saved === undefined) delete process.env["XYNE_ACTIVE_TOOL_CAP"];
    else process.env["XYNE_ACTIVE_TOOL_CAP"] = saved;
  });

  it("uses the agent's cap, then the env cap, then 25, ignoring values under 10", () => {
    delete process.env["XYNE_ACTIVE_TOOL_CAP"];
    expect(activeToolCap(undefined)).toBe(ACTIVE_TOOL_CAP_DEFAULT);
    process.env["XYNE_ACTIVE_TOOL_CAP"] = "30";
    expect(activeToolCap({})).toBe(30);
    expect(activeToolCap({ activeToolCap: 40 })).toBe(40);
    expect(activeToolCap({ activeToolCap: 3 })).toBe(30);
  });

  it("reads only string tool names from the usage rank, deduplicated", () => {
    expect(readToolUsageRank({ toolUsageRank: ["a", 7, "b", "a", ""] })).toEqual(["a", "b"]);
    expect(readToolUsageRank({ toolUsageRank: "a,b" })).toEqual([]);
    expect(readToolUsageRank(undefined)).toEqual([]);
  });

  it("is registered and off by default", () => {
    expect(OPTIMIZATIONS.active_tool_cap.defaultOn).toBe(false);
  });
});

describe("demoted tools in the catalog", () => {
  const tool = (name: string): ToolDefinition =>
    ({ name, description: `${name}: does a thing`, parameters: { type: "object", properties: {} } }) as unknown as ToolDefinition;

  it("groups MCP tools by server and the rest under agent-tools", () => {
    expect(demotedCatalogName("Xyne_Workflows__workflow_get")).toBe("Xyne_Workflows");
    expect(demotedCatalogName("create-video-explainer")).toBe("agent-tools");
  });

  it("keeps the write flag so search-tools can filter by risk", () => {
    expect(demotedCatalogItem(tool("sandbox-run"), true).entry.isWrite).toBe(true);
    expect(demotedCatalogItem(tool("webfetch"), false).entry.isWrite).toBeUndefined();
  });

  it("lists demoted tools by name in the index and loads them on request", async () => {
    const items = ["create-video-explainer", "Xyne_Workflows__workflow_validate"].map((n) => demotedCatalogItem(tool(n), false));
    const index = renderToolCatalogForPrompt(items.map((i) => i.entry), { fullIndex: true });
    expect(index).toContain("create-video-explainer");
    expect(index).toContain("Xyne_Workflows__workflow_validate");
    const meta = buildFastModeMetaTools({
      catalog: items.map((i) => i.entry),
      controller: { getActiveToolSet: () => [], loadTools: async (n: string[]) => ({ loaded: n, alreadyLoaded: [], unknown: [], activeToolSet: n, maxActiveTools: 100 }) },
    });
    const load = meta.find((t) => t.name === "load-tools")! as unknown as { execute: (id: string, p: unknown) => Promise<{ content: Array<{ text: string }> }> };
    const out = (await load.execute("t", { names: ["create-video-explainer"] })).content[0]!.text;
    expect(out).toContain("Loaded: create-video-explainer");
  });
});
