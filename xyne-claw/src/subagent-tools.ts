/**
 * Subagent tools — wraps groups of MCP tools into single high-level tools.
 *
 * Definitions (prompts, names, descriptions, serverType mapping) come from xyne-claw-shared.
 * Tool grouping comes from the MCP layer (McpToolGroup with serverType + writeTools).
 * This file provides the execution factory (pi-coding-agent session spawning).
 */

import { Type } from "@sinclair/typebox";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  createAgentSession,
  AuthStorage,
  SessionManager,
  ModelRegistry,
  codingTools,
  type ToolDefinition,
} from "@mariozechner/pi-coding-agent";
import type { ThinkingLevel } from "@mariozechner/pi-ai";
import { AGENT, SERVER } from "./config.js";
import { SUBAGENT_DEFINITIONS, getSandboxSession, probeSession, REPO_CONFIGS, type SubagentDefinition, type SetupStep } from "xyne-claw-shared";
import type { McpToolGroup } from "./mcp.js";
import { resolveModel, applyCopilotProxyIfNeeded, pushInvocation, type CopilotConfig, type ClaudeConfig, type CodexConfig, type ToolInvocation } from "./agent.js";
import { takeCitations, recordCitations } from "./citations.js";

/**
 * Build a punchy spinner label for any subagent's child-tool call so chat
 * shows the actual action ("🚢 git push origin HEAD", "🔍 spaces-search:
 * deployment errors") instead of a static cycling label. Returns null when
 * nothing meaningful can be derived.
 */
function summarizeChildToolCall(toolName: string, args: unknown): string | null {
  const a = (args ?? {}) as Record<string, unknown>;
  const trim = (v: unknown, n: number): string => {
    const s = typeof v === "string" ? v : "";
    if (!s) return "";
    const one = s.replace(/\s+/g, " ").trim();
    return one.length > n ? `${one.slice(0, n)}…` : one;
  };

  if (toolName === "sandbox-run" || toolName === "sandbox-run-detached") {
    const cmd = trim(a["cmd"] ?? a["command"], 80);
    if (!cmd) {
      return toolName === "sandbox-run-detached" ? "▶️ kicking off a background job" : "🐚 running a command";
    }
    const m: Array<[RegExp, string]> = [
      [/^npm install\b|^npm i\b|^npm ci\b|^pnpm install\b|^yarn(?: add)?\b/, `📦 installing deps — ${cmd}`],
      [/^npm run dev\b|^npm run start\b|^vite\b|^next dev\b/, `🚀 firing up dev server — ${cmd}`],
      [/^npm (run )?test\b|^jest\b|^vitest\b|playwright test\b/, `🧪 running tests — ${cmd}`],
      [/tsc.*--noEmit/, `🔍 typechecking — ${cmd}`],
      [/^npm run build\b|^tsc\b|^next build\b|^vite build\b/, `🔨 building — ${cmd}`],
      [/^git clone\b/, `🌐 cloning repo — ${cmd}`],
      [/^git (checkout|switch|branch)\b/, `🌿 branch ops — ${cmd}`],
      [/^git (add|commit)\b/, `💾 committing — ${cmd}`],
      [/^git push\b/, `🚢 pushing — ${cmd}`],
      [/^git (pull|fetch)\b/, `📥 fetching — ${cmd}`],
      [/^git (status|log|diff|show|blame)\b/, `🔭 git inspect — ${cmd}`],
      [/^(npx )?playwright\b|screenshot/i, `📸 driving browser — ${cmd}`],
      [/^python3?\b|^pip(3| install)?\b/, `🐍 python — ${cmd}`],
      [/^node\b/, `🟢 node — ${cmd}`],
      [/^docker\b/, `🐳 docker — ${cmd}`],
      [/^(curl|wget)\b/, `🌐 fetching — ${cmd}`],
      [/^(grep|rg|ag)\b/, `🔎 searching — ${cmd}`],
      [/^(ls|find|tree)\b/, `📂 listing — ${cmd}`],
      [/^(cat|head|tail|less|more)\b/, `📖 reading — ${cmd}`],
      [/^mkdir\b/, `📁 mkdir — ${cmd}`],
      [/^(rm|unlink)\b/, `🗑️ removing — ${cmd}`],
      [/^kubectl\b/, `☸️ kubectl — ${cmd}`],
      [/^echo\b|^printf\b/, `💬 echoing — ${cmd}`],
      [/^apt(-get)?\b/, `🛠️ apt — ${cmd}`],
    ];
    for (const [re, label] of m) if (re.test(cmd)) return label;
    return toolName === "sandbox-run-detached" ? `▶️ background — ${cmd}` : `🐚 sandbox-run — ${cmd}`;
  }

  if (toolName === "sandbox-write-file") {
    const path = trim(a["path"], 80);
    if (!path) return "📝 writing a file";
    const ext = (path.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
    const tag: Record<string, string> = {
      ts: "📝 TypeScript", tsx: "📝 TypeScript",
      js: "📝 JS", jsx: "📝 JS", mjs: "📝 JS", cjs: "📝 JS",
      css: "🎨 styling", scss: "🎨 styling", sass: "🎨 styling", less: "🎨 styling",
      json: "⚙️ config", yaml: "⚙️ config", yml: "⚙️ config", toml: "⚙️ config",
      md: "📄 docs", mdx: "📄 docs",
      html: "🌐 HTML", htm: "🌐 HTML",
      py: "🐍 Python",
      go: "🐹 Go", rs: "🦀 Rust", java: "☕ Java",
      sh: "🐚 shell", bash: "🐚 shell",
      sql: "🗄️ SQL",
    };
    return `${tag[ext] ?? "📝 file"} → ${path}`;
  }

  if (toolName === "sandbox-read-file") {
    const path = trim(a["path"], 80);
    return path ? `📖 reading ${path}` : "📖 reading a file";
  }

  if (toolName === "sandbox-poll-job") {
    return "⏳ checking background job";
  }

  if (toolName === "sandbox-repo-setup") {
    const repo = trim(a["repoName"] ?? "repo", 30);
    const branch = trim(a["branchName"], 40);
    const base = trim(a["baseBranch"], 30);
    if (base) return `🛠️ spinning up ${repo} VM (${branch} ← ${base})`;
    return branch ? `🛠️ spinning up ${repo} VM (${branch})` : `🛠️ spinning up ${repo} VM`;
  }

  if (toolName === "sandbox-create") {
    return "🔧 conjuring a sandbox VM";
  }

  // MCP tool format: ${ServerName}__${tool-name}
  // (e.g. "Xyne_Spaces__spaces-search", "Bitbucket__create_pull_request").
  // Surface the inner tool + the question/query so chat shows what's being
  // asked, not just the wrapper subagent name.
  if (toolName.includes("__")) {
    const idx = toolName.indexOf("__");
    const server = toolName.slice(0, idx);
    const inner = toolName.slice(idx + 2);
    const serverIcon: Record<string, string> = {
      Xyne_Spaces: "🔍",
      bitbucket: "🔀",
      Bitbucket: "🔀",
      grafana: "📊",
      deepwiki: "📚",
      context7: "📖",
      pgm: "📋",
      "juspay-internal-tools": "🏦",
    };
    const icon = serverIcon[server] ?? "🔧";
    const detail = trim(
      a["question"] ?? a["query"] ?? a["q"] ?? a["search"] ?? a["text"] ?? a["title"] ?? a["path"],
      70,
    );
    return detail ? `${icon} ${inner}: ${detail}` : `${icon} ${inner}`;
  }

  // Generic fallback for other custom tools — first string arg if any.
  const firstString = Object.values(a).find((v) => typeof v === "string" && v.length > 0) as string | undefined;
  if (firstString) return `🔧 ${toolName}: ${trim(firstString, 70)}`;
  return `🔧 ${toolName}`;
}

/**
 * Inline POST to xyne-claw-auth's /webhook/progress with just a toolLabel —
 * same shape as createProgressReporter's send() in agent.ts. Reuses the
 * existing Redis-backed session lookup + Spaces ephemeral-progress wiring,
 * no new exports. Used by every subagent to overlay live child-tool activity
 * on top of the parent's static cycling label.
 */
function pushChildLabel(progressUrl: string | undefined, sessionId: string, toolLabel: string): void {
  if (!progressUrl) return;
  fetch(progressUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(SERVER.s2sKey ? { "x-s2s-key": SERVER.s2sKey } : {}),
    },
    body: JSON.stringify({ sessionId, toolLabel }),
    signal: AbortSignal.timeout(5_000),
  }).catch((err) => {
    console.warn(`[child-progress] label push failed: ${err instanceof Error ? err.message : String(err)}`);
  });
}

/**
 * Progress context threaded into subagent tools so child sessions can push their
 * own tool invocations upward (frontend renders them nested under the parent row).
 *
 * `parentToolsUsed`, if provided, is a mutable array reference shared with the
 * parent's runTask — subagents append their inner MCP tool names there so chain
 * conditions (`toolsMustInclude`) can match against nested tools like
 * `Bitbucket__create_pull_request`, not just the wrapper name `bitbucket`.
 */
export interface SubagentProgressCtx {
  progressUrl?: string;
  parentSessionId: string;
  parentToolsUsed?: string[];
  /** Parent agent's conversationId/agentSlug — used by the sandbox subagent to
   *  look up an existing kata session for this conversation and surface it to
   *  the cold-started child LLM via a system reminder. */
  parentMeta?: { conversationId?: string; agentSlug?: string };
}

// ── Shared MCP loader helper ──────────────────────────────────────────────

async function loadMcpTools(
  command: string,
  args: string[],
  prefix: string,
): Promise<{ tools: ToolDefinition[]; client: Client }> {
  const transport = new StdioClientTransport({ command, args });
  const client = new Client({ name: "xyne-claw", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);

  const { tools } = await client.listTools();
  const toolDefs: ToolDefinition[] = tools.map((t) => ({
    name: `${prefix}__${t.name}`,
    label: `${prefix} / ${t.name}`,
    description: t.description ?? `${prefix} tool: ${t.name}`,
    parameters: Type.Unsafe(t.inputSchema ?? { type: "object", properties: {} }),
    async execute(_toolCallId: string, params: unknown) {
      const result = await client.callTool({ name: t.name, arguments: params as Record<string, unknown> });
      const content = (result.content as Array<{ type: string; text?: string }>);
      const text = content
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("\n");
      return {
        content: [{ type: "text" as const, text: text || "(no result)" }],
        details: {},
      };
    },
  }));

  return { tools: toolDefs, client };
}

// ── Subagent factory (creates child AgentSession) ─────────────────────────

export interface SkillTrigger {
  toolName: string;
  skillSlug: string;
  skillContent: string;
  when: "before" | "after";
  prompt?: string | undefined;
}

export interface SubagentProviderResolution {
  parentProvider: string;
  subagentProviders?: Record<string, string> | undefined;
  providerConfigs?: Record<string, { apiKey: string; model: string; baseUrl?: string; authType?: string }> | undefined;
}

/**
 * Returns (provider, providerConfig) for a subagent, or undefined to fall back to shared LITELLM.
 */
function resolveProviderForSubagent(
  def: SubagentDefinition,
  resolution: SubagentProviderResolution | undefined,
): { provider: string; config: CopilotConfig | ClaudeConfig | CodexConfig } | undefined {
  const chosen = resolution?.subagentProviders?.[def.name] ?? resolution?.parentProvider;
  if ((chosen === "copilot" || chosen === "claude" || chosen === "codex") && resolution?.providerConfigs?.[chosen]) {
    const cfg = resolution.providerConfigs[chosen]!;
    const base: CopilotConfig | ClaudeConfig | CodexConfig = {
      apiKey: cfg.apiKey,
      model: cfg.model,
      ...(cfg.baseUrl ? { baseUrl: cfg.baseUrl } : {}),
      ...(cfg.authType ? { authType: cfg.authType } : {}),
    };
    return { provider: chosen, config: base };
  }
  return undefined;
}

function makeSubagentTool(def: SubagentDefinition, tools: ToolDefinition[], skillTriggers?: SkillTrigger[], skills?: Array<{ slug?: string; name: string; description?: string; content: string }>, providerResolution?: SubagentProviderResolution, progressCtx?: SubagentProgressCtx): ToolDefinition {
  const resolvedProvider = resolveProviderForSubagent(def, providerResolution);
  const tool: ToolDefinition & { progressLabels?: string[] } = {
    name: def.name,
    label: def.name,
    description: def.description,
    progressLabels: def.progressLabels,
    parameters: Type.Object({
      [def.paramName]: Type.String({ description: def.paramDescription }),
    }),
    async execute(_toolCallId: string, params: unknown) {
      const question = (params as Record<string, string>)[def.paramName] ?? "";
      console.log(`[${def.name}] Subagent: ${question.slice(0, 100)}`);

      // Sticky-label state hoisted out of the try block so the catch handler
      // can clear the timer on early failures without leaking the interval.
      let stickyLabel: string | null = null;
      const stickyTimer = progressCtx?.progressUrl
        ? setInterval(() => {
            if (stickyLabel && progressCtx.progressUrl) {
              pushChildLabel(progressCtx.progressUrl, progressCtx.parentSessionId, stickyLabel);
            }
          }, 4_000)
        : null;

      try {
        const authStorage = AuthStorage.create();
        const modelRegistry = new ModelRegistry(authStorage);

        // Apply copilot proxy (no-op for other providers) then register model via the same helper the parent uses
        const effectiveConfig = await applyCopilotProxyIfNeeded(resolvedProvider?.provider, resolvedProvider?.config);
        const model = resolveModel(modelRegistry, resolvedProvider?.provider, effectiveConfig);
        console.log(`[${def.name}] Using provider=${resolvedProvider?.provider ?? "litellm"} model=${resolvedProvider?.config.model ?? "shared"}`);

        const { session } = await createAgentSession({
          model,
          thinkingLevel: AGENT.thinkingLevel as ThinkingLevel,
          tools: codingTools,
          sessionManager: SessionManager.inMemory(),
          authStorage,
          modelRegistry,
          customTools: tools,
        });

        const toolsUsed: string[] = [];
        // Track in-flight child tool calls so we can emit full ToolInvocation objects on _end.
        const childInflight = new Map<string, { toolName: string; args: unknown; startedAt: number }>();
        session.subscribe((event) => {
          if (event.type === "tool_execution_start") {
            console.log(`[${def.name}] Tool: ${event.toolName}`);
            childInflight.set(event.toolCallId, { toolName: event.toolName, args: event.args, startedAt: Date.now() });
            // Overlay a punchy live label on the parent's spinner so chat
            // shows what's actually running. The sticky timer above keeps
            // re-pushing this label so it survives the parent's 10s keep-alive.
            if (progressCtx?.progressUrl) {
              const label = summarizeChildToolCall(event.toolName, event.args);
              if (label) {
                stickyLabel = label;
                pushChildLabel(progressCtx.progressUrl, progressCtx.parentSessionId, label);
              }
            }
            // Emit a "running" placeholder so the parent's UI shows a pending
            // child row (with a spinner) underneath the subagent block. The
            // same toolCallId later gets replaced by the completed row.
            if (progressCtx) {
              const pendingInv: ToolInvocation = {
                toolName: event.toolName,
                args: event.args,
                result: "",
                isError: false,
                startedAt: new Date().toISOString(),
                durationMs: 0,
                status: "running",
                toolCallId: event.toolCallId,
                parentToolCallId: _toolCallId,
                subagentName: def.name,
              };
              pushInvocation(progressCtx.progressUrl, progressCtx.parentSessionId, pendingInv);
            }
          }
          if (event.type === "tool_execution_end") {
            toolsUsed.push(event.toolName);
            // Surface inner tool names to the parent's toolsUsed so chain
            // conditions can match on specific MCP tools (e.g.
            // Bitbucket__create_pull_request) rather than only the subagent
            // wrapper (`bitbucket`).
            progressCtx?.parentToolsUsed?.push(event.toolName);

            // Tier 1 citation propagation: drain any structured citations the
            // child invocation produced and stash them under the wrapper's
            // toolCallId. The parent agent's tool_execution_end will collect
            // these and attach them to the wrapper ToolInvocation it emits.
            const childCitations = takeCitations(event.toolCallId);
            if (childCitations) {
              recordCitations(_toolCallId, childCitations);
            }

            // Tier 2: stream nested child invocation up to the parent's progressUrl
            // so the frontend can render it under the subagent row.
            if (progressCtx) {
              const started = childInflight.get(event.toolCallId);
              if (started) {
                const resultStr = (() => {
                  try {
                    if (typeof event.result === "string") return event.result;
                    return JSON.stringify(event.result);
                  } catch {
                    return String(event.result);
                  }
                })();
                const truncated = resultStr.length > 10_000
                  ? `${resultStr.slice(0, 10_000)}\n…[truncated ${resultStr.length - 10_000} chars]`
                  : resultStr;
                const childInv: ToolInvocation = {
                  toolName: event.toolName,
                  args: started.args,
                  result: truncated,
                  isError: event.isError,
                  startedAt: new Date(started.startedAt).toISOString(),
                  durationMs: Date.now() - started.startedAt,
                  status: "completed",
                  toolCallId: event.toolCallId,
                  parentToolCallId: _toolCallId,
                  subagentName: def.name,
                  ...(childCitations ? { citations: childCitations } : {}),
                };
                pushInvocation(progressCtx.progressUrl, progressCtx.parentSessionId, childInv);
                childInflight.delete(event.toolCallId);
              }
            }
          }
        });

        let systemPrompt = def.systemPrompt;
        if (skills && skills.length > 0) {
          const skillBlock = skills.map((s) => `### Skill: ${s.name}\n${s.content}`).join("\n\n");
          systemPrompt = `${systemPrompt}\n\n## Injected Skills\n${skillBlock}`;
        }

        // For sandbox subagent: surface every configured repo (workdir, ports,
        // setup steps) so the child LLM knows where things live and what's
        // expected to be set up — no guessing /home/user/ paths or trying to
        // re-install deps that sandbox-repo-setup already handles.
        if (def.serverType === "custom:sandbox") {
          const blocks: string[] = [];
          for (const [name, cfg] of Object.entries(REPO_CONFIGS)) {
            const installPkgs = cfg.steps
              .filter((s: SetupStep): s is { type: "install"; packages: string[]; cmd?: string } => s.type === "install")
              .flatMap((s) => s.packages);
            const hasServices = cfg.steps.some((s: SetupStep) => s.type === "services");
            const devservers = cfg.steps
              .filter((s: SetupStep): s is { type: "devserver"; name: string; cmd: string; cwd: string } => s.type === "devserver")
              .map((s) => {
                const port = cfg.ports?.[s.name];
                return port ? `${s.name} → http://localhost:${port}` : s.name;
              });
            const setupLines: string[] = [];
            if (installPkgs.length > 0) setupLines.push(`  - npm install in: ${installPkgs.map((p) => `\`${p}/\``).join(", ")}`);
            if (hasServices) setupLines.push(`  - docker compose services up (\`npm run services\`)`);
            for (const ds of devservers) setupLines.push(`  - dev server: ${ds}`);
            blocks.push(
              `### ${name}\n` +
                `- Repo: \`${cfg.repoUrl}\`\n` +
                `- Default base branch: \`${cfg.defaultBranch}\`\n` +
                `- Workdir in VM: \`${cfg.workDir}\`\n` +
                `- Template: \`${cfg.template}\`\n` +
                (setupLines.length > 0 ? `- \`sandbox-repo-setup\` auto-runs:\n${setupLines.join("\n")}\n` : "") +
                (cfg.ports ? `- Ports: ${Object.entries(cfg.ports).map(([k, v]) => `${k}=${v}`).join(", ")}` : ""),
            );
          }
          if (blocks.length > 0) {
            systemPrompt += `\n\n## Available Repos for sandbox-repo-setup\n${blocks.join("\n\n")}\n\nWhen working on a configured repo, ALWAYS use its listed workdir (e.g. \`/workspace/xyne-spaces\`) — never \`/home/user/\` or \`/tmp\`. Dependencies are installed by \`sandbox-repo-setup\`; \`npm test\` / \`npx tsc\` / \`npm run build\` should just work without re-installing.`;
            console.log(`[${def.name}] Repo configs injected: ${Object.keys(REPO_CONFIGS).join(", ")}`);
          }
        }

        // For sandbox subagent: surface any existing live sandbox session
        // so the cold-started child LLM doesn't redo sandbox-repo-setup.
        // Only reuse sessions on a real repo template — agent-workspace
        // (gvisor/Nix) or the legacy kata docker-dev. Bare-warmpool VMs
        // have no git creds or services baked in and are useless for repo
        // work — if one is cached, ignore it so the LLM is forced to call
        // sandbox-repo-setup.
        if (def.serverType === "custom:sandbox" && progressCtx?.parentMeta?.conversationId) {
          const conversationId = progressCtx.parentMeta.conversationId;
          const agentSlug = progressCtx.parentMeta.agentSlug ?? "";
          const storeKey = agentSlug ? `${conversationId}_${agentSlug}` : conversationId;
          const existing = getSandboxSession(storeKey);
          const isRepoTemplate = !!existing && (
            existing.id.includes("agent-workspace") || existing.id.includes("docker-dev")
          );
          if (existing && isRepoTemplate) {
            const alive = await probeSession(existing, storeKey).catch(() => false);
            if (alive) {
              systemPrompt += `\n\n## Active Session\nSandbox session \`${existing.id}\` is already provisioned for this conversation. Repo is at \`/workspace/xyne-spaces\` (shallow clone of default branch) and Nix-managed services (postgres :5433, redis :6379, livekit :7880, zero :4848, fake-gcs :4443, y-sweet :8080) are already pre-realized in /nix/store from the pod's prebake step.\nUse \`sandbox-run\` with \`sessionId="${existing.id}"\` for ALL commands. DO NOT call \`sandbox-repo-setup\` again unless the session has died.`;
              console.log(`[${def.name}] Active session injected: ${existing.id}`);
            }
          } else if (existing) {
            console.log(`[${def.name}] Skipping injection: cached session ${existing.id} is not a repo-template`);
          }
        }

        await session.prompt(`${systemPrompt}\n\n## Question\n${question}`);

        const sq = session as unknown as { _agentEventQueue?: Promise<void> };
        if (sq._agentEventQueue) await sq._agentEventQueue;

        let text = session.getLastAssistantText() ?? "(No findings)";
        session.dispose();
        if (stickyTimer) clearInterval(stickyTimer);
        stickyLabel = null;

        // Check skill triggers for inner tools
        if (skillTriggers && skillTriggers.length > 0) {
          const prefix = `${def.name}:`;
          for (const trigger of skillTriggers) {
            if (!trigger.toolName.startsWith(prefix)) continue;
            const innerTool = trigger.toolName.slice(prefix.length);
            if (toolsUsed.includes(innerTool)) {
              console.log(`[${def.name}] Skill trigger: ${trigger.skillSlug} fired (inner tool ${innerTool} was used)`);
              text += `\n\n---\n**[Skill Injected: ${trigger.skillSlug}]** _(configured by user in agent settings)_`;
              if (trigger.prompt) text += `\nInstruction: ${trigger.prompt}`;
              text += `\n\n${trigger.skillContent}\n---`;
            }
          }
        }

        console.log(`[${def.name}] Done: ${toolsUsed.length} tools, ${text.length} chars`);
        return { content: [{ type: "text" as const, text }], details: {} };
      } catch (err) {
        if (stickyTimer) clearInterval(stickyTimer);
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[${def.name}] Failed:`, msg);
        return { content: [{ type: "text" as const, text: `${def.name} subagent failed: ${msg}` }], details: {} };
      }
    },
  };
  return tool;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Extract the original tool name from a prefixed name (e.g. "Xyne_Spaces__spaces-search" → "spaces-search")
 */
function extractToolName(prefixedName: string): string {
  const idx = prefixedName.indexOf("__");
  return idx >= 0 ? prefixedName.slice(idx + 2) : prefixedName;
}

/**
 * Group MCP tool groups into subagent wrappers based on serverType.
 * Also wraps custom tools that match a subagent definition (e.g. custom:pgm).
 * Write tools (from adapter's writeTools) stay as direct tools in the parent agent.
 * Server types without a matching SubagentDefinition pass through as direct tools.
 */
export function buildSubagentTools(
  groups: McpToolGroup[],
  customTools?: ToolDefinition[],
  skillTriggers?: SkillTrigger[],
  subagentSkills?: Record<string, Array<{ slug?: string; name: string; description?: string; content: string }>>,
  providerResolution?: SubagentProviderResolution,
  progressCtx?: SubagentProgressCtx,
  // Tools to splice into a specific subagent's palette beyond what came from
  // its own MCP server. Keyed by SubagentDefinition.name (e.g. "sandbox").
  // Used to give the sandbox subagent direct access to playwright MCP without
  // forcing the LLM to bootstrap chromium via sandbox-run on every fresh VM.
  bonusToolsBySubagent?: Record<string, ToolDefinition[]>,
): {
  subagentTools: ToolDefinition[];
  directTools: ToolDefinition[];
  remainingCustomTools: ToolDefinition[];
} {
  const subagentTools: ToolDefinition[] = [];
  const directTools: ToolDefinition[] = [];

  for (const group of groups) {
    const def = SUBAGENT_DEFINITIONS.find((d) => d.serverType === group.serverType);

    if (def) {
      // Split write tools out as direct (they need user approval in the parent agent)
      const writeSet = new Set(group.writeTools.map(String));
      const readTools = group.tools.filter((t) => !writeSet.has(extractToolName(t.name)));
      const writeTools = group.tools.filter((t) => writeSet.has(extractToolName(t.name)));

      if (readTools.length > 0) {
        const skills = subagentSkills?.[def.name] ?? subagentSkills?.["__default"];
        const bonus = bonusToolsBySubagent?.[def.name] ?? [];
        subagentTools.push(makeSubagentTool(def, [...readTools, ...bonus], skillTriggers, skills, providerResolution, progressCtx));
      }
      directTools.push(...writeTools);
    } else {
      // No subagent definition for this server type — keep all as direct
      directTools.push(...group.tools);
    }
  }

  // Wrap custom tools that match a subagent definition (e.g. custom:pgm)
  const remainingCustomTools: ToolDefinition[] = [];
  if (customTools) {
    // Group custom tools by source prefix (e.g. "custom:pgm" → "pgm" tools)
    const customBySource = new Map<string, ToolDefinition[]>();
    for (const t of customTools) {
      const source = (t as unknown as { source?: string }).source;
      if (source) {
        const list = customBySource.get(source) ?? [];
        list.push(t);
        customBySource.set(source, list);
      } else {
        remainingCustomTools.push(t);
      }
    }

    for (const [source, tools] of customBySource) {
      const def = SUBAGENT_DEFINITIONS.find((d) => d.serverType === source);
      if (def && tools.length > 0) {
        const customSkills = subagentSkills?.[def.name] ?? subagentSkills?.["__default"];
        // The sandbox subagent must not see sandbox-destroy — child LLMs were
        // calling it after errors / "to be tidy" and nuking the cached VM,
        // forcing the next conversation turn to redo a 10-min sandbox-repo-setup.
        // Cleanup is handled by Lifecycle.shutdownTime + idle timer; no tool needed.
        //
        // We compare against `slug` (the canonical identifier used in tool
        // calls), NOT `name` (which is a human-readable label like
        // "Sandbox Destroy Session"). Earlier code filtered by `name` which
        // never matched — sandbox-destroy was leaking into the palette and
        // the LLM was happily calling it, causing massive SandboxClaim
        // churn (visible as random pods getting reaped under active
        // sessions; xyne-kata DELETE-/sessions/:id → K8s API DELETE).
        const filteredTools = source === "custom:sandbox"
          ? tools.filter((t) => (t as ToolDefinition & { slug?: string }).slug !== "sandbox-destroy")
          : tools;
        const bonus = bonusToolsBySubagent?.[def.name] ?? [];
        subagentTools.push(makeSubagentTool(def, [...filteredTools, ...bonus], skillTriggers, customSkills, providerResolution, progressCtx));
      } else {
        remainingCustomTools.push(...tools);
      }
    }
  }

  return { subagentTools, directTools, remainingCustomTools };
}

// ── DeepWiki & Context7 MCP loaders (stdio transport, cached) ─────────────

let cachedDeepwikiTools: McpToolGroup | null = null;

export async function loadDeepwikiTools(): Promise<McpToolGroup | null> {
  if (cachedDeepwikiTools) return cachedDeepwikiTools;
  try {
    const { tools } = await loadMcpTools("npx", ["-y", "deepwiki-mcp"], "deepwiki");
    cachedDeepwikiTools = { serverType: "deepwiki", serverName: "deepwiki", tools, writeTools: [] };
    console.log(`[deepwiki] Loaded ${tools.length} tools: ${tools.map((t) => t.name).join(", ")}`);
    return cachedDeepwikiTools;
  } catch (err) {
    console.warn(`[deepwiki] Failed to load tools: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

let cachedContext7Tools: McpToolGroup | null = null;

export async function loadContext7Tools(): Promise<McpToolGroup | null> {
  if (cachedContext7Tools) return cachedContext7Tools;
  try {
    const { tools } = await loadMcpTools("npx", ["-y", "@upstash/context7-mcp@latest"], "context7");
    cachedContext7Tools = { serverType: "context7", serverName: "context7", tools, writeTools: [] };
    console.log(`[context7] Loaded ${tools.length} tools: ${tools.map((t) => t.name).join(", ")}`);
    return cachedContext7Tools;
  } catch (err) {
    console.warn(`[context7] Failed to load tools: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

// Playwright MCP runs in the xyne-claw pod (NOT inside the sandbox VM).
// Trade-off: avoids the per-conversation `npx playwright install chromium`
// bootstrap (170 MB download seen in prod) and gives the LLM typed tools
// (browser_navigate / browser_click / browser_screenshot / …) instead of
// inline `node -e` scripts. But the browser cannot reach localhost services
// running inside the user's sandbox VM (different network namespace) — for
// driving sandbox-internal dev servers (e.g. http://localhost:5173 inside
// the sandbox), the agent still needs `sandbox-run`.
//
// `--isolated` gives each MCP tool call a fresh browser context so concurrent
// invocations don't share cookies/storage. Heavy parallel use will still
// queue on this single MCP process per pod.
let cachedPlaywrightTools: McpToolGroup | null = null;

export async function loadPlaywrightTools(): Promise<McpToolGroup | null> {
  if (cachedPlaywrightTools) return cachedPlaywrightTools;
  try {
    const { tools } = await loadMcpTools(
      "npx",
      ["-y", "@playwright/mcp@latest", "--headless", "--isolated"],
      "playwright",
    );
    cachedPlaywrightTools = { serverType: "playwright", serverName: "playwright", tools, writeTools: [] };
    console.log(`[playwright] Loaded ${tools.length} tools: ${tools.map((t) => t.name).join(", ")}`);
    return cachedPlaywrightTools;
  } catch (err) {
    console.warn(`[playwright] Failed to load tools: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}
