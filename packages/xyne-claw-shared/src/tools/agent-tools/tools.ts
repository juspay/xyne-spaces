/**
 * Agent-authoring tools — let an agent build and revise the platform's own
 * primitives (agents, subagents, MCP servers) with human approval.
 *
 * All of them are WRITE tools, which is the whole design: the pod signs a
 * pending action instead of executing, claw-auth renders an Approve/Decline
 * card, and the row is only written in flow-action's `serverType==="agent-tools"`
 * branch after a human clicks. The pod has no DB access and never mutates
 * anything itself — same contract as create-skill, which is why these sit in the
 * same group as create-skill/update-skill rather than inventing a parallel
 * approval system.
 *
 * `source` is the catalog's grouping key (routes/tools.ts derives customGroups
 * from distinct `custom:*` sources, and the picker humanizes it), so every tool
 * here shares one source and the seven appear together under "Agent Tools".
 *
 * The update-* tools do NOT self-apply either: the approver may not be the
 * target's owner, so flow-action re-checks edit rights against the row at apply
 * time. An agent proposing a change it has no right to make is refused there,
 * not here — the pod cannot be trusted to enforce an ACL it cannot read.
 */

import type { ToolDefinition } from "../types.js";

/** Shared by every tool below — the catalog group and the picker label. */
export const AGENT_TOOLS_SOURCE = "custom:agent-tools";

/** Write tools never run in the pod; this is the message the model gets back. */
const queued = (what: string) => async (): Promise<string> =>
  `${what} is an approval-gated write tool: the user will see an Approve/Decline card. ` +
  `Nothing is created or changed until they approve.`;

/** Tool-identifier list shared by the agent/subagent authoring schemas. */
const toolsProperty = {
  type: "array" as const,
  description:
    "Tool identifiers to grant, e.g. 'web-search', 'sandbox-run-command', or a subagent name like 'github'. " +
    "Names that do not exist in this workspace are dropped and reported on the card rather than failing the whole request — " +
    "call list-available-tools first if you are unsure what exists.",
  items: { type: "string" as const },
};

// Shared by update-agent / update-subagent. Mirrors update-skill's `edits`
// contract (see skill-management/tools.ts): long prompts do not survive as tool
// arguments, so surgical anchored edits are the safe way to change them.
const promptEditsProperty = {
  type: "array" as const,
  description:
    "PREFERRED way to change the system prompt: anchored replacements applied in order to the CURRENT prompt. " +
    "Each oldText must be copied EXACTLY from the current prompt and must be unique within it; newText replaces it. " +
    "To insert a new section, use an edit whose oldText is the exact line to insert after, and whose newText is that " +
    "same line followed by the new section. Mutually exclusive with systemPrompt.",
  items: {
    type: "object" as const,
    properties: {
      oldText: { type: "string" as const, description: "Exact snippet copied from the current prompt (unique within it)." },
      newText: { type: "string" as const, description: "Replacement text." },
    },
    required: ["oldText", "newText"],
  },
};

export const createAgentTool: ToolDefinition = {
  slug: "create-agent",
  name: "Create Agent",
  description:
    "Draft a NEW agent and submit it for approval. The user sees an Approve/Decline card showing the agent's name, " +
    "identifier, description, system prompt and the tools it would be granted; NOTHING is created until they approve. " +
    "On approval the agent is created as a PERSONAL agent owned by the approving user. " +
    "Write a real system prompt — role, procedure, which tools to use when, output format and limits — not a one-line summary; " +
    "a vague prompt produces an agent that does not work. " +
    "Use this when the user asks you to 'create an agent', 'make me a bot for X', or 'set up an agent that does Y'.",
  source: AGENT_TOOLS_SOURCE,
  isWriteTool: true,
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Human-readable agent title, e.g. 'Release Notes Writer'. Required." },
      slug: {
        type: "string",
        description:
          "Optional kebab-case identifier, e.g. 'release-notes-writer'. Auto-derived from name when omitted. " +
          "Must be unique in the workspace — approval fails if another agent has taken it.",
      },
      description: { type: "string", description: "One line describing what the agent is for, shown wherever it is listed. Required." },
      systemPrompt: {
        type: "string",
        description:
          "The agent's full operating instructions. Required. Cover its role, the procedure it follows, which tools to use when, " +
          "the output format, and what it must not do.",
      },
      modelId: { type: "string", description: "Optional model id to pin, e.g. 'claude-sonnet-5'. Omit to inherit the workspace default." },
      color: { type: "string", description: "Optional hex accent colour for the agent's avatar, e.g. '#6366f1'." },
      tools: toolsProperty,
    },
    required: ["name", "description", "systemPrompt"],
  },
  execute: queued("create-agent"),
};

export const updateAgentTool: ToolDefinition = {
  slug: "update-agent",
  name: "Update Agent",
  description:
    "Propose a change to an EXISTING agent. The user sees an Approve/Decline card with what would change; nothing is " +
    "applied until they approve, and approval is refused unless the approver may edit that agent (its owner, an EDITOR, or an admin). " +
    "Send ONLY the fields you want to change — omitted fields are left exactly as they are. " +
    "To change the system prompt, PREFER `promptEdits` — anchored {oldText, newText} replacements against the current prompt " +
    "(read it first via get-agent-config so your oldText anchors are exact; each must appear exactly once). " +
    "`systemPrompt` (full replacement) is only accepted while the current prompt is under ~8K chars — larger bodies get " +
    "truncated as tool arguments and would destroy the prompt, so the server rejects them. " +
    "`tools` REPLACES the agent's tool list rather than adding to it, so read the agent's current tools first (get-agent-config) " +
    "and send the full intended list. " +
    "This mutates an agent that may be running right now, so prefer a narrow change over a rewrite.",
  source: AGENT_TOOLS_SOURCE,
  isWriteTool: true,
  inputSchema: {
    type: "object",
    properties: {
      slug: { type: "string", description: "Identifier of the agent to change, e.g. 'release-notes-writer'. Required." },
      name: { type: "string", description: "New display name. Omit to leave unchanged." },
      description: { type: "string", description: "New one-line description. Omit to leave unchanged." },
      systemPrompt: {
        type: "string",
        description:
          "Full replacement system prompt — SMALL PROMPTS ONLY (rejected when the current prompt exceeds ~8K chars; " +
          "use promptEdits instead). Omit to leave unchanged.",
      },
      promptEdits: promptEditsProperty,
      modelId: { type: "string", description: "New pinned model id. Omit to leave unchanged." },
      color: { type: "string", description: "New hex accent colour. Omit to leave unchanged." },
      tools: {
        ...toolsProperty,
        description:
          "REPLACEMENT tool list — this overwrites the agent's current tools, it does not append. " +
          "Read the current list first and send the whole intended set. Omit to leave the tools untouched.",
      },
      summary: { type: "string", description: "Short note on what is changing and why — shown to the approver alongside the change." },
    },
    required: ["slug"],
  },
  execute: queued("update-agent"),
};

export const createSubagentTool: ToolDefinition = {
  slug: "create-subagent",
  name: "Create Subagent",
  description:
    "Draft a NEW subagent and submit it for approval. A subagent is a narrow specialist that a parent agent delegates a single " +
    "question to — it has its own system prompt and its own small tool set, and it answers one parameter (e.g. a question or a query). " +
    "The user sees an Approve/Decline card; nothing is created until they approve. On approval it is created in the approver's " +
    "organization, owned by them, and becomes selectable as a tool on any agent. " +
    "Create a subagent (rather than an agent) when the thing you want is a delegated capability, not something a human talks to directly.",
  source: AGENT_TOOLS_SOURCE,
  isWriteTool: true,
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description:
          "Subagent identifier, e.g. 'changelog'. Lowercase, no spaces — this is the name the parent agent calls. " +
          "Must be unique in the organization. Required.",
      },
      description: { type: "string", description: "One line telling a parent agent WHEN to delegate to this subagent. Required." },
      systemPrompt: { type: "string", description: "The subagent's full operating instructions. Required." },
      paramName: {
        type: "string",
        description: "Name of the single input parameter the parent passes, e.g. 'question' or 'query'. Defaults to 'question'.",
      },
      paramDescription: { type: "string", description: "What the parent agent should put in that parameter. Required." },
      tools: toolsProperty,
      progressLabels: {
        type: "array",
        description: "Optional short status lines shown while the subagent works, e.g. ['Reading commits', 'Drafting notes'].",
        items: { type: "string" },
      },
    },
    required: ["name", "description", "systemPrompt", "paramDescription"],
  },
  execute: queued("create-subagent"),
};

export const updateSubagentTool: ToolDefinition = {
  slug: "update-subagent",
  name: "Update Subagent",
  description:
    "Propose a change to an EXISTING subagent. The user sees an Approve/Decline card; nothing is applied until they approve, " +
    "and approval is refused unless the approver may edit that subagent (its creator, an EDITOR share, or an admin). " +
    "Send ONLY the fields you want to change. To change the system prompt, PREFER `promptEdits` (anchored {oldText, newText} " +
    "replacements — read the current prompt first); `systemPrompt` full replacement is rejected once the current prompt " +
    "exceeds ~8K chars. `tools` REPLACES the subagent's tool list rather than adding to it.",
  source: AGENT_TOOLS_SOURCE,
  isWriteTool: true,
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Identifier of the subagent to change, e.g. 'changelog'. Required." },
      description: { type: "string", description: "New one-line description. Omit to leave unchanged." },
      systemPrompt: {
        type: "string",
        description:
          "Full replacement system prompt — SMALL PROMPTS ONLY (rejected when the current prompt exceeds ~8K chars; " +
          "use promptEdits instead). Omit to leave unchanged.",
      },
      promptEdits: promptEditsProperty,
      paramName: { type: "string", description: "New input parameter name. Omit to leave unchanged." },
      paramDescription: { type: "string", description: "New description of the input parameter. Omit to leave unchanged." },
      tools: {
        ...toolsProperty,
        description: "REPLACEMENT tool list — overwrites the current tools rather than appending. Omit to leave them untouched.",
      },
      enabled: { type: "boolean", description: "Set false to disable the subagent without deleting it. Omit to leave unchanged." },
      summary: { type: "string", description: "Short note on what is changing and why — shown to the approver." },
    },
    required: ["name"],
  },
  execute: queued("update-subagent"),
};

export const createMcpTool: ToolDefinition = {
  slug: "create-mcp",
  name: "Create MCP Server",
  description:
    "Register a NEW MCP server so its tools become available in this workspace. The user sees an Approve/Decline card; " +
    "nothing is registered until they approve.\n" +
    "HTTP ONLY — you may only propose an https:// endpoint. Command-based (stdio) servers are arbitrary code execution and are " +
    "rejected outright, so do not pass command/args/env/cwd.\n" +
    "NEVER pass a credential. Not a token, key, password or Authorization header — not in any field, including the url. " +
    "Anything you pass ends up in the transcript and the logs and stays there after the token is rotated. Instead list the header " +
    "NAMES the server needs in `headerNames`; the user fills the values themselves in the dashboard, where they are encrypted at rest.\n" +
    "Use this when the user asks to 'connect X', 'add the X MCP server', or 'hook up X's tools'.",
  source: AGENT_TOOLS_SOURCE,
  isWriteTool: true,
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Human-readable server name, e.g. 'Acme Ticketing'. Required." },
      url: { type: "string", description: "The server's https:// MCP endpoint. Required. Must be https — http is rejected, localhost included." },
      description: { type: "string", description: "One line on what the server's tools do." },
      headerNames: {
        type: "array",
        description:
          "NAMES ONLY of the HTTP headers this server needs for auth, e.g. ['X-Api-Key']. The user supplies the values. " +
          "Passing a value here is rejected.",
        items: { type: "string" },
      },
    },
    required: ["name", "url"],
  },
  execute: queued("create-mcp"),
};

export const AGENT_TOOL_DEFS: ToolDefinition[] = [
  createAgentTool,
  updateAgentTool,
  createSubagentTool,
  updateSubagentTool,
  createMcpTool,
];
