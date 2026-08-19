import { describe, it, expect } from "vitest";
import {
  AGENT_TOOLS_SOURCE,
  AGENT_TOOL_DEFS,
  createAgentTool,
  updateAgentTool,
  createSubagentTool,
  updateSubagentTool,
  createMcpTool,
} from "./tools.js";
import { createSkillTool, updateSkillTool } from "../skill-management/tools.js";
import { validateMcpProposal } from "../../flow/mcp-proposal.js";
import { getAllCustomTools } from "../registry.js";

describe("the Agent Tools group", () => {
  it("puts all seven authoring tools under one source", () => {
    // The picker derives its groups from distinct `custom:*` sources, so a
    // shared source IS the grouping — this is what makes them appear together.
    const slugs = [...AGENT_TOOL_DEFS, createSkillTool, updateSkillTool]
      .filter((t) => t.source === AGENT_TOOLS_SOURCE)
      .map((t) => t.slug)
      .sort();
    expect(slugs).toEqual([
      "create-agent",
      "create-mcp",
      "create-skill",
      "create-subagent",
      "update-agent",
      "update-skill",
      "update-subagent",
    ]);
  });

  it("registers every tool in the shared catalog", () => {
    const registered = new Set(getAllCustomTools().map((t) => t.slug));
    for (const tool of AGENT_TOOL_DEFS) expect(registered).toContain(tool.slug);
  });

  it("humanizes to 'Agent Tools' the way the picker renders it", () => {
    const label = AGENT_TOOLS_SOURCE.replace("custom:", "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    expect(label).toBe("Agent Tools");
  });
});

describe("approval gating", () => {
  it("makes every authoring tool an approval-gated write tool", () => {
    // None of these may self-apply: the pod has no DB access and the approver's
    // rights are only knowable claw-auth-side.
    for (const tool of AGENT_TOOL_DEFS) expect(tool.isWriteTool).toBe(true);
  });

  it("never persists from the pod-side execute body", async () => {
    for (const tool of AGENT_TOOL_DEFS) {
      const out = await tool.execute({});
      expect(out.toLowerCase()).toContain("approve");
    }
  });

  it("signs actions under the agent-tools serverType", () => {
    // custom-tools.ts derives serverType by stripping the "custom:" prefix, so
    // the source doubles as the flow-action branch key.
    for (const tool of AGENT_TOOL_DEFS) {
      expect(tool.source.replace("custom:", "")).toBe("agent-tools");
    }
  });
});

describe("tool schemas", () => {
  it("requires enough to build a working agent", () => {
    expect(createAgentTool.inputSchema.required).toEqual(
      expect.arrayContaining(["name", "description", "systemPrompt"]),
    );
  });

  it("requires only the target on updates, so callers can send one field", () => {
    expect(updateAgentTool.inputSchema.required).toEqual(["slug"]);
    expect(updateSubagentTool.inputSchema.required).toEqual(["name"]);
  });

  it("requires a subagent's delegation contract", () => {
    // A subagent with no paramDescription is uncallable — the parent agent has
    // nothing to put in the parameter.
    expect(createSubagentTool.inputSchema.required).toEqual(
      expect.arrayContaining(["name", "description", "systemPrompt", "paramDescription"]),
    );
  });

  it("tells the model that tools REPLACE rather than append", () => {
    for (const tool of [updateAgentTool, updateSubagentTool]) {
      const tools = tool.inputSchema.properties["tools"] as { description: string };
      expect(tools.description).toMatch(/replace/i);
    }
  });

  it("offers surgical prompt edits on both update tools", () => {
    // Mirrors update-skill: long prompts get truncated as tool arguments, so
    // anchored {oldText, newText} edits are the safe path and full replacement
    // is small-prompts-only. Both the schema and the description the model
    // reads must carry the contract.
    for (const tool of [updateAgentTool, updateSubagentTool]) {
      const edits = tool.inputSchema.properties["promptEdits"] as {
        description: string;
        items: { required: string[] };
      };
      expect(edits.items.required).toEqual(["oldText", "newText"]);
      expect(edits.description).toMatch(/exactly/i);
      expect(edits.description).toMatch(/mutually exclusive/i);
      const prompt = tool.inputSchema.properties["systemPrompt"] as { description: string };
      expect(prompt.description).toMatch(/small prompts only/i);
      expect(tool.description).toMatch(/promptEdits/);
    }
  });
});

describe("create-mcp carries the no-credentials policy", () => {
  it("asks for header NAMES and never values", () => {
    expect(createMcpTool.inputSchema.properties).toHaveProperty("headerNames");
    expect(createMcpTool.inputSchema.properties).not.toHaveProperty("headers");
    for (const forbidden of ["token", "apiKey", "authorization", "command", "args", "env"]) {
      expect(createMcpTool.inputSchema.properties).not.toHaveProperty(forbidden);
    }
  });

  it("states both rules in the description the model reads", () => {
    expect(createMcpTool.description).toMatch(/https/i);
    expect(createMcpTool.description).toMatch(/never pass a credential/i);
  });

  it("is enforced by the shared validator, not just described", () => {
    const good = { name: "Acme", url: "https://mcp.acme.com/v1", headerNames: ["X-Api-Key"] };
    expect(validateMcpProposal(good).ok).toBe(true);
    // The three failure modes the description warns about.
    expect(validateMcpProposal({ ...good, url: "http://mcp.acme.com" }).ok).toBe(false);
    expect(validateMcpProposal({ ...good, command: "npx -y server" }).ok).toBe(false);
    expect(validateMcpProposal({ ...good, token: "ghp_1234567890abcdefghijklmnopqrstuvwx" }).ok).toBe(false);
  });
});
