import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import { SUBAGENT_DEFINITIONS, type SubagentDefinition } from "xyne-claw-shared";

export interface SessionExportRun {
  sessionId: string;
  agentSlug: string;
  task: string;
  result: string | null;
  error: string | null;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  toolInvocations: Array<{
    toolName: string;
    args: unknown;
    result: string;
    isError: boolean;
    startedAt: string;
    durationMs: number;
  }> | null;
}

/**
 * Serialize a session (ordered list of runs + meta) to Claude Code's transcript JSONL format.
 * Each line is one tree-entry in Claude Code's `~/.claude/projects/<project>/<sessionId>.jsonl` schema.
 *
 * Schema (distilled from Claude Code CLI transcripts):
 *  { type: "user",        message: { role: "user",      content: string | Array<...> }, uuid, parentUuid, sessionId, timestamp }
 *  { type: "assistant",   message: { role: "assistant", content: Array<{type:"text"|"tool_use"|"thinking", ...}> }, uuid, parentUuid, sessionId, timestamp }
 *
 * We reconstruct the shape from our per-run AgentRun + ChatMessage data. The original
 * interleaving of text and tool_use blocks isn't preserved (we have run.result as a single
 * text blob + a flat toolInvocations array). The reconstruction is:
 *
 *   user[turn]        ← run.task
 *   assistant[turn]   ← tool_use(s) from toolInvocations
 *   user[turn]        ← tool_result(s)
 *   assistant[turn]   ← text(run.result)
 *
 * This is "good enough for Claude Code to resume" — the model sees task, tool calls + results,
 * and the final answer. The user can continue the conversation with whatever tools Claude Code
 * has locally; the original xyne-claw tool names appear as opaque `tool_use` blocks but aren't
 * re-executed since Claude Code doesn't know about them.
 */
export function renderClaudeCodeJsonl(runs: SessionExportRun[], sessionId: string): string {
  const lines: string[] = [];
  let lastUuid: string | null = null;

  const push = (entry: Record<string, unknown>) => {
    const uuid = randomUUID();
    const line = { ...entry, uuid, parentUuid: lastUuid, sessionId };
    lines.push(JSON.stringify(line));
    lastUuid = uuid;
  };

  // Context preamble — tells the model what it's resuming and that its old tools are gone
  const agentSlug = runs[0]?.agentSlug ?? "agent";
  const startedAt = runs[0] ? new Date(runs[0].startedAt).toISOString() : new Date().toISOString();
  push({
    type: "user",
    message: {
      role: "user",
      content: [{
        type: "text",
        text: [
          "# Resumed xyne-claw session",
          "",
          `**Imported from:** xyne-claw Control Center`,
          `**Original agent:** \`${agentSlug}\``,
          `**Session started:** ${startedAt}`,
          `**Messages:** ${runs.length}`,
          "",
          "The transcript that follows is the history of a conversation that ran on a different tool registry (xyne-claw subagents: `spaces`, `bitbucket`, `grafana`, etc.). Those tools are **not available here** — their past invocations are summarized inline as context only. Use Claude Code's own tools for any new actions.",
          "",
          "---",
        ].join("\n"),
      }],
    },
    timestamp: startedAt,
  });
  // Short acknowledgment so the assistant's first "turn" isn't the preamble itself
  push({
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Got it — I have the prior transcript loaded. Continue whenever you're ready." }],
    },
    timestamp: startedAt,
  });

  for (const run of runs) {
    const ts = run.startedAt.toISOString();

    // User turn — the prompt
    push({
      type: "user",
      message: { role: "user", content: run.task },
      timestamp: ts,
    });

    // Flatten tool calls into a prose summary so Claude Code doesn't try to re-invoke
    // tools it has no definition for. The model sees "[Tool call: X] Input: … Result: …"
    // as plain historical context and can continue with its own tools.
    const invocations = run.toolInvocations ?? [];
    const toolsPreamble = invocations.length === 0 ? "" : invocations.map((inv) => {
      let argsStr: string;
      try { argsStr = JSON.stringify(inv.args ?? {}, null, 2); }
      catch { argsStr = String(inv.args); }
      const header = `[Tool call: ${inv.toolName}${inv.isError ? " — error" : ""}] (${inv.durationMs}ms)`;
      return `${header}\nInput:\n\`\`\`json\n${argsStr}\n\`\`\`\nResult:\n\`\`\`\n${inv.result || "(empty)"}\n\`\`\``;
    }).join("\n\n") + "\n\n";

    const finalText = run.result ?? (run.error ? `[error] ${run.error}` : "(no response)");
    const assistantText = toolsPreamble + finalText;
    push({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: assistantText }],
      },
      timestamp: run.completedAt?.toISOString() ?? ts,
    });
  }

  return lines.join("\n") + "\n";
}

/**
 * Serialize a session to a human-readable markdown transcript. Good for sharing,
 * pasting into docs, or feeding into any LLM harness (OpenCode, Aider, chat UIs).
 */
export function renderMarkdown(runs: SessionExportRun[], header: { agentSlug: string; conversationId: string | null }): string {
  const lines: string[] = [];
  lines.push(`# Session transcript — ${header.agentSlug}`);
  if (header.conversationId) lines.push(`_Thread:_ \`${header.conversationId}\``);
  lines.push(`_Exported:_ ${new Date().toISOString()}`);
  lines.push("");

  runs.forEach((run, turnIdx) => {
    lines.push(`## Turn ${turnIdx + 1}`);
    lines.push("");
    lines.push(`**🧑 User:**`);
    lines.push("");
    lines.push(run.task);
    lines.push("");

    const invocations = run.toolInvocations ?? [];
    if (invocations.length > 0) {
      lines.push(`**🔧 Tool calls:**`);
      lines.push("");
      invocations.forEach((inv) => {
        lines.push(`- \`${inv.toolName}\` (${inv.durationMs}ms${inv.isError ? " — error" : ""})`);
        lines.push("  ```json");
        try {
          const argLines = JSON.stringify(inv.args ?? {}, null, 2).split("\n");
          argLines.forEach((l) => lines.push(`  ${l}`));
        } catch { lines.push(`  ${String(inv.args)}`); }
        lines.push("  ```");
        if (inv.result) {
          lines.push("  <details><summary>result</summary>");
          lines.push("");
          lines.push("  ```");
          inv.result.split("\n").forEach((l) => lines.push(`  ${l}`));
          lines.push("  ```");
          lines.push("  </details>");
        }
        lines.push("");
      });
    }

    lines.push(`**🤖 ${run.agentSlug}:**`);
    lines.push("");
    if (run.result) {
      lines.push(run.result);
    } else if (run.error) {
      lines.push(`> ⚠️ **Error:** ${run.error}`);
    } else if (run.status === "running") {
      lines.push(`_(still running…)_`);
    } else {
      lines.push(`_(no response)_`);
    }
    lines.push("");
    lines.push("---");
    lines.push("");
  });

  return lines.join("\n");
}

// ── Claude Code project bundle (zip) ──────────────────────────────────

export interface ProjectBundleInput {
  agent: { slug: string; name: string; description: string; systemPrompt: string };
  skills: Array<{ slug: string; name: string; description: string; content: string }>;
  runs: SessionExportRun[];
  sessionId: string;
}

function slugifyFilename(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

/** Safe single-line YAML scalar — strips newlines and wraps in double quotes, escaping internal quotes/backslashes. */
function yamlScalar(s: string): string {
  const cleaned = s.replace(/\s+/g, " ").trim();
  // Use double-quoted style so colons/dashes inside the value are unambiguous.
  return `"${cleaned.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function renderSubagentMarkdown(def: SubagentDefinition): string {
  return [
    "---",
    `name: ${def.name}`,
    `description: ${yamlScalar(def.description)}`,
    "---",
    "",
    def.systemPrompt.trim(),
    "",
    "<!--",
    `Imported from xyne-claw. Original parameter: \`${def.paramName}\` — ${def.paramDescription}`,
    `Original MCP serverType: ${def.serverType}`,
    "",
    "In xyne-claw this subagent had live access to MCP tools for this server. Here in Claude Code, it runs as a prompt/persona only; it uses Claude Code's local tools (Read, Edit, Bash, etc). If you need live access to the original server, install the matching MCP server locally and wire it up in .mcp.json.",
    "-->",
    "",
  ].join("\n");
}

function renderSkillMarkdown(skill: { slug: string; name: string; description: string; content: string }): string {
  const lines = [
    "---",
    `name: ${skill.slug || slugifyFilename(skill.name)}`,
  ];
  if (skill.description) lines.push(`description: ${yamlScalar(skill.description)}`);
  lines.push("---", "", skill.content.trim(), "");
  return lines.join("\n") + "\n";
}

function renderClaudeMd(agent: ProjectBundleInput["agent"]): string {
  return [
    `# ${agent.name}`,
    "",
    agent.description ? `${agent.description}\n` : "",
    "## System prompt",
    "",
    agent.systemPrompt.trim(),
    "",
    "<!-- Imported from xyne-claw as the root agent prompt. Claude Code reads this file from the project root on every turn. -->",
    "",
  ].filter(Boolean).join("\n");
}

function renderReadme(agent: ProjectBundleInput["agent"], subagentCount: number, skillCount: number, sessionId: string): string {
  return [
    `# ${agent.name} — Claude Code project bundle`,
    "",
    `Exported from xyne-claw on ${new Date().toISOString().slice(0, 10)}.`,
    "",
    "## What's in this zip",
    "",
    `- \`CLAUDE.md\` — the root agent prompt (${agent.slug}). Claude Code picks this up automatically when \`claude\` runs in this directory.`,
    `- \`.claude/agents/*.md\` — ${subagentCount} subagent persona${subagentCount === 1 ? "" : "s"} (spaces, bitbucket, grafana, etc). Invoke with \`/agents\` in Claude Code.`,
    `- \`.claude/skills/*.md\` — ${skillCount} skill${skillCount === 1 ? "" : "s"} attached to the agent. Auto-loaded.`,
    `- \`${sessionId}.jsonl\` — the session transcript in Claude Code's format. Load with \`/resume\` inside the project.`,
    "",
    "## Quickstart",
    "",
    "```bash",
    "# 1. Extract somewhere",
    `unzip ${sessionId}.zip -d ~/my-agent-project`,
    "",
    "# 2. Put the session jsonl where Claude Code expects it",
    "mkdir -p ~/.claude/projects/$(basename ~/my-agent-project)",
    "mv ~/my-agent-project/*.jsonl ~/.claude/projects/$(basename ~/my-agent-project)/",
    "",
    "# 3. Open the project",
    "cd ~/my-agent-project",
    "claude",
    "",
    "# Inside Claude Code:",
    "/resume    # loads the prior conversation",
    "/agents    # lists the imported subagents",
    "```",
    "",
    "## MCP servers",
    "",
    "This bundle includes a `.mcp.json` with **two MCP servers pre-wired** — Claude Code starts them automatically when you open the project:",
    "",
    "- **`context7`** — fetches current library / framework documentation (React, Prisma, etc). Used by the `context7` subagent.",
    "- **`deepwiki`** — AI-powered docs for any GitHub repository. Used by the `deepwiki` subagent.",
    "",
    "Both are public npm packages; no auth needed. They `npx` on first use.",
    "",
    "### Turning on the others",
    "",
    "The remaining subagents (`spaces`, `bitbucket`, `grafana`, `pgm`) need MCP servers you'd set up yourself. `.mcp.json` has **commented-out templates** under `_disabled` — copy the ones you want into `mcpServers` and fill in the env values:",
    "",
    "- **Bitbucket** — community MCP at [matanyemini/bitbucket-mcp](https://github.com/MatanYemini/bitbucket-mcp). Needs `BITBUCKET_USERNAME`, `BITBUCKET_TOKEN`, `BITBUCKET_WORKSPACE`.",
    "- **Grafana** — official `@grafana/mcp-grafana`. Needs `GRAFANA_URL` + `GRAFANA_API_KEY`.",
    "- **Sequential-thinking** — Anthropic's reasoning MCP, no auth.",
    "- **Filesystem** — scoped file access, point at your project path.",
    "",
    "`xyne-spaces` and `pgm` don't have public MCP packages yet — those subagents run as persona-only unless you deploy the xyne-claw MCP adapter yourself.",
    "",
    "### What works without any setup",
    "",
    "Claude Code's built-in tools (Read, Edit, Bash, Grep, Glob, WebFetch) are always available. The `context7` and `deepwiki` MCPs work out of the box. Everything else is opt-in.",
    "",
    "Original tool invocations from the xyne-claw session are preserved as **text summaries** in the transcript — the model has full context of what was called and what it returned, even when the tools themselves aren't running locally.",
    "",
  ].join("\n");
}

/** A .mcp.json that pre-wires the MCP servers we already use publicly (context7, deepwiki)
 * and ships commented-out templates for community MCPs the user can opt into. */
function renderMcpJson(): string {
  // NOTE: JSON doesn't support comments natively. We emit a JSON file with a _comment key and
  // write the commented-out templates inside string values under `_disabled` so the JSON stays
  // valid. The README explains how to enable them.
  const config = {
    _comment: "Bundled by xyne-claw export. `context7` and `deepwiki` work immediately. See `_disabled` below for others — copy into `mcpServers` and replace env placeholders to enable.",
    mcpServers: {
      context7: {
        command: "npx",
        args: ["-y", "@upstash/context7-mcp@latest"],
      },
      deepwiki: {
        command: "npx",
        args: ["-y", "deepwiki-mcp"],
      },
    },
    _disabled: {
      "// bitbucket (community MCP — needs your Bitbucket token)": {
        command: "npx",
        args: ["-y", "@matanyemini/bitbucket-mcp"],
        env: {
          BITBUCKET_USERNAME: "${BITBUCKET_USERNAME}",
          BITBUCKET_TOKEN: "${BITBUCKET_TOKEN}",
          BITBUCKET_WORKSPACE: "${BITBUCKET_WORKSPACE}",
        },
      },
      "// grafana (official MCP — needs your Grafana URL + API key)": {
        command: "npx",
        args: ["-y", "@grafana/mcp-grafana"],
        env: {
          GRAFANA_URL: "${GRAFANA_URL}",
          GRAFANA_API_KEY: "${GRAFANA_API_KEY}",
        },
      },
      "// sequential-thinking (Anthropic's reasoning MCP)": {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
      },
      "// filesystem (local file read/write)": {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/your/project"],
      },
    },
  };
  return JSON.stringify(config, null, 2);
}

export async function renderClaudeProjectZip(input: ProjectBundleInput): Promise<Buffer> {
  const { agent, skills, runs, sessionId } = input;
  const zip = new JSZip();

  // Root agent prompt
  zip.file("CLAUDE.md", renderClaudeMd(agent));

  // Subagents
  const agentsFolder = zip.folder(".claude/agents")!;
  for (const def of SUBAGENT_DEFINITIONS) {
    agentsFolder.file(`${slugifyFilename(def.name)}.md`, renderSubagentMarkdown(def));
  }

  // Skills (from agent's attached skills)
  const skillsFolder = zip.folder(".claude/skills")!;
  for (const skill of skills) {
    skillsFolder.file(`${slugifyFilename(skill.slug || skill.name)}.md`, renderSkillMarkdown(skill));
  }

  // MCP servers — context7 + deepwiki work out of the box; templates for others
  zip.file(".mcp.json", renderMcpJson());

  // Session transcript — drop at root; the README explains where to move it
  zip.file(`${sessionId}.jsonl`, renderClaudeCodeJsonl(runs, sessionId));

  // README with quickstart + caveats
  zip.file("README.md", renderReadme(agent, SUBAGENT_DEFINITIONS.length, skills.length, sessionId));

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
}
