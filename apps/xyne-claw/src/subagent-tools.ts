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
import { provisionStdioCommand } from "./mcp-provision.js";
import {
  createAgentSession,
  AuthStorage,
  SessionManager,
  ModelRegistry,
  DefaultResourceLoader,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { workspacePath } from "./workspace.js";
import type { ThinkingLevel } from "@earendil-works/pi-ai";
import { AGENT, LITELLM, SERVER } from "./config.js";
import { ensureSessionDebugDir, sessionDir } from "./session-store.js";
import { SUBAGENT_DEFINITIONS, findSubagentDefinitionForServer, isPresentationToolSource, getSandboxSession, probeSession, REPO_CONFIGS, buildSandboxStoreKey, type SubagentDefinition, type SetupStep } from "xyne-claw-shared";
import { acquireFollowUpLock, isValidFollowUpHandle } from "./subagent-followup.js";
import type { McpToolGroup } from "./mcp.js";
import { resolveModel, applyCopilotProxyIfNeeded, capCustomToolOutput, pushDebugProgress, pushInvocation, type CopilotConfig, type ClaudeConfig, type CodexConfig, type DebugEventRecord, type ProgressDest, type ToolInvocation } from "./agent.js";
import { compactionExtension } from "./compaction-extension.js";
import { installMidTurnCompaction } from "./mid-turn-compaction.js";
import { createScopedToolMap } from "./scoped-tools.js";
import type { ClawStreamMeta } from "xyne-claw-shared";
import { takeCitations, recordCitations } from "./citations.js";
import { writeSessionSkills, deleteSessionSkills } from "./session-skills.js";
import { installLlmCallMetrics } from "./llm-call-metrics.js";
import { installToolBudget, type ToolBudgetTracker } from "./tool-budget.js";
import { metric } from "./metrics.js";
import crypto from "node:crypto";
import { dirname, isAbsolute, join } from "node:path";

import { createLogger } from "./logger.js";
const log = createLogger("subagent-tools");

/**
 * Per-parent-run subagent result cache (D).
 *
 * Key: parentSessionId → (subagentName + normalized question hash) → in-flight Promise.
 *
 * Why a Promise (not the resolved value): if the parent emits two identical
 * subagent calls in the same turn (concurrent tool_use blocks), we want both
 * callers to share ONE underlying execution. Caching the resolved value only
 * helps when the second call comes after the first finished.
 *
 * Lifetime: 30 minutes per entry. A parent run that's still active after 30
 * min is exceptional; this is a safety eviction so the Map can't leak.
 * Without a parentSessionId we skip caching (cross-run pollution risk).
 */
const SUBAGENT_CACHE_TTL_MS = 30 * 60 * 1000;

export interface SubagentArtifact {
  relPath: string;
  marker: string;
  fileName: string;
  mimeType: string;
  sha256: string;
}

function encodeArtifactPart(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, "+");
}

export function parseSubagentArtifact(toolName: string, resultText: string): SubagentArtifact | null {
  if (!toolName.endsWith("__spaces-fetch-attachment") && toolName !== "spaces-fetch-attachment") return null;

  const markerMatch = /^Workspace file marker:\s*(\{\{file:([^}]+)\}\})\s*$/m.exec(resultText);
  const metadataMatch = /^Attachment metadata:\s*(\{.*\})\s*$/m.exec(resultText);
  if (!markerMatch || !metadataMatch) return null;

  try {
    const metadata = JSON.parse(metadataMatch[1]!) as Record<string, unknown>;
    const fileName = typeof metadata["fileName"] === "string" ? metadata["fileName"] : null;
    const mimeType = typeof metadata["mimeType"] === "string" ? metadata["mimeType"] : null;
    const sha256 = typeof metadata["sha256"] === "string" ? metadata["sha256"] : null;
    if (!fileName || !mimeType || !sha256 || !/^[a-f0-9]{64}$/i.test(sha256)) return null;
    return {
      marker: markerMatch[1]!,
      relPath: markerMatch[2]!,
      fileName,
      mimeType,
      sha256,
    };
  } catch {
    return null;
  }
}

export function renderSubagentArtifacts(artifacts: SubagentArtifact[]): string {
  if (artifacts.length === 0) return "";
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const artifact of artifacts) {
    const key = `${artifact.sha256}:${artifact.relPath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const artifactId = artifact.sha256.slice(0, 16);
    const machineMarker = `[SUBAGENT_ARTIFACT:spaces:${artifactId}:${encodeArtifactPart(artifact.fileName)}:${encodeArtifactPart(artifact.mimeType)}]`;
    lines.push(
      `- ${machineMarker} path=\`${artifact.relPath}\` marker=\`${artifact.marker}\` fileName=\`${artifact.fileName}\` mimeType=\`${artifact.mimeType}\` sha256=\`${artifact.sha256}\``,
    );
  }
  if (lines.length === 0) return "";
  return [
    "",
    "---",
    "**Subagent artifacts available to parent**",
    "These files were fetched by the child tool and written into the parent workspace `.context/` directory. For MCP tools that accept file input, pass the `marker` value so bytes are forwarded out-of-band instead of through model context.",
    ...lines,
  ].join("\n");
}

/**
 * Per-call timeout for stdio MCPs spawned from xyne-claw (deepwiki, context7,
 * playwright). The `@modelcontextprotocol/sdk` runs an internal timer
 * initialised from `options.timeout ?? DEFAULT_REQUEST_TIMEOUT_MSEC` (60s) on
 * every request — without passing `timeout` here, slow trace/research calls
 * abort at exactly 60s regardless of any AbortSignal we attach.
 *
 * Matches MCP_REQUEST_TIMEOUT_MS in xyne-claw-auth/backend/src/mcp/runner.ts.
 * Keep them in sync — both layers' MCP calls have the same product semantics
 * (a tool that needs longer than 10 min has a different problem).
 */
const MCP_REQUEST_TIMEOUT_MS = 600_000;
type SubagentExecResult = { content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> };
type CachedEntry = { promise: Promise<SubagentExecResult>; insertedAt: number };
const subagentResultCache = new Map<string, Map<string, CachedEntry>>();
type SubagentDebugEvent = {
  seq: number;
  at: string;
  kind: string;
  toolCallId?: string;
  data: Record<string, unknown>;
};

function normalizeQuestion(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ");
}

function subagentCacheKey(subagentName: string, question: string): string {
  const norm = normalizeQuestion(question);
  // Hash so the key stays bounded even for very long prompts. SHA-1 because
  // it's faster than SHA-256 and we don't need cryptographic strength.
  const h = crypto.createHash("sha1").update(`${subagentName}::${norm}`).digest("hex");
  return h;
}

function sweepSubagentCache(): void {
  const now = Date.now();
  for (const [sid, sub] of subagentResultCache) {
    for (const [k, v] of sub) {
      if (now - v.insertedAt > SUBAGENT_CACHE_TTL_MS) sub.delete(k);
    }
    if (sub.size === 0) subagentResultCache.delete(sid);
  }
}
setInterval(sweepSubagentCache, 5 * 60 * 1000).unref();

/**
 * Subagent system-prompt preamble (C).
 *
 * Prepended to every subagent's `def.systemPrompt` at execute time. Two
 * goals: (1) reduce inner-turn count by pushing the subagent toward
 * "issue all the tool calls you need in ONE turn", (2) reduce inner work
 * by emphasising concision in the returned text.
 *
 * Kept SHORT — every byte here ships with every subagent invocation and
 * counts against the inner context budget.
 */
const SUBAGENT_PREAMBLE = [
  "## Operating Principles",
  "",
  "**Parallelism.** If you need to call MULTIPLE tools to answer the question, emit ALL of them in ONE assistant turn (multiple tool_use blocks side-by-side). The framework runs them concurrently. Do NOT emit one tool, wait for the result, then emit the next — that triples wall-clock time. Only chain sequentially when a later tool's input genuinely depends on an earlier tool's output.",
  "",
  "**Concision.** You are a subagent serving a parent agent. Return only the answer the parent needs, not your reasoning. 1-3 short sections of findings. No preambles like \"Based on my search...\" — the parent doesn't see your search.",
  "",
  "**Single sweep.** Decide your tool plan up front from the question alone. Resist the urge to re-query with refined parameters after seeing partial results — that's a slow loop and the parent can ask a follow-up if needed.",
  "",
  "---",
  "",
].join("\n");

/**
 * Variant preamble for retrieval subagents (def.allowRequery === true). Same
 * parallelism + concision guidance, but the single-sweep clause is replaced
 * with explicit permission to iterate: hard lookups often need a second refined
 * query (broader keywords, a different channel, a wider window) before the
 * answer exists, and Vespa search returns shallow chunks that must be drilled
 * into. Capping at one sweep silently drops those hits.
 */
const SUBAGENT_REQUERY_PREAMBLE = [
  "## Operating Principles",
  "",
  "**Parallelism.** If you need to call MULTIPLE tools to answer the question, emit ALL of them in ONE assistant turn (multiple tool_use blocks side-by-side). The framework runs them concurrently. Do NOT emit one tool, wait for the result, then emit the next — that triples wall-clock time. Only chain sequentially when a later tool's input genuinely depends on an earlier tool's output.",
  "",
  "**Concision.** You are a subagent serving a parent agent. Return only the answer the parent needs, not your reasoning. 1-3 short sections of findings. No preambles like \"Based on my search...\" — the parent doesn't see your search.",
  "",
  "**Iterate when retrieval is thin.** Start with a parallel sweep of your best queries, then DRILL DOWN: search returns shallow chunks, so fetch the full content of your top hits before concluding. If results are empty or clearly miss what was asked, you MAY re-query ONCE or TWICE with refined parameters (broader/narrower keywords, a different channel or user, a wider date window). Stop as soon as you have enough to answer — do NOT loop indefinitely or re-run identical queries.",
  "",
  "---",
  "",
].join("\n");

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
      "juspay-internal-tools": "🏦",
      Attio: "📇",
      MailerLite: "📧",
      Miro: "🖼️",
      Webflow: "🌐",
      Wix: "🌐",
      Honeycomb: "🍯",
      Customer_io: "📧",
      kibana: "🔎",
      "ardra-finops": "💰",
      calendly: "📅",
      jotform: "📝",
      docusign: "✍️",
      egnyte: "📁",
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
function pushChildLabel(progressUrl: ProgressDest, sessionId: string, toolLabel: string): void {
  if (!progressUrl) return;
  if (typeof progressUrl !== "string") {
    try { progressUrl.progressLabel(sessionId, toolLabel, {} as ClawStreamMeta); } catch (err) {
      log.warn(`[child-progress] label emit failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }
  fetch(progressUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(SERVER.s2sKey ? { "x-s2s-key": SERVER.s2sKey } : {}),
    },
    body: JSON.stringify({ sessionId, toolLabel }),
    signal: AbortSignal.timeout(5_000),
  }).catch((err) => {
    log.warn(`[child-progress] label push failed: ${err instanceof Error ? err.message : String(err)}`);
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
/** A subagent spawned with `run_in_background`: its DETACHED execution promise
 *  plus lifecycle state. The parent's model loop gets an immediate ack and keeps
 *  working; runTask (agent.ts) drains this registry after the loop settles and
 *  injects each completed result back into the parent session. Keyed by the
 *  spawning tool_call_id — which is also the `parentToolCallId` of the child's
 *  nested tool rows, so the wrapper invocation and its children line up. */
export interface BackgroundSubagentTask {
  /** == the spawning tool_call_id. */
  taskId: string;
  subagentName: string;
  question: string;
  startedAt: number;
  status: "running" | "completed" | "error";
  /** The detached doExecute() promise. Its rejection is swallowed by an attached
   *  handler that records status/error — the drain loop reads these, never the
   *  raw promise result. */
  promise: Promise<SubagentExecResult>;
  /** Child answer text, filled on completion. */
  result?: string;
  error?: string;
  /** True once runTask has injected this back into the parent session. */
  delivered: boolean;
}
export type BackgroundSubagentRegistry = Map<string, BackgroundSubagentTask>;

export interface SubagentProgressCtx {
  progressUrl?: ProgressDest;
  parentSessionId: string;
  /** Persistent parent agent session key used for filesystem debug artifacts. */
  parentDebugSessionId?: string;
  parentToolsUsed?: string[];
  /** Parent agent's conversationId/agentSlug — used by the sandbox subagent to
   *  look up an existing kata session for this conversation and surface it to
   *  the cold-started child LLM via a system reminder. */
  parentMeta?: { userId?: string; conversationId?: string; agentSlug?: string };
  /** Propagated from the parent run's AbortController. When the user hits the
   *  Stop button on the chat UI, the parent's abortSignal fires; the subagent
   *  observes it inside its pi-session lifecycle (see executeSubagent) and
   *  aborts its own session.prompt() promptly instead of running to
   *  completion. Without this wire, parent-side cancel only stops the parent
   *  LLM loop — child sessions keep burning tokens and tool calls. */
  abortSignal?: AbortSignal;
  /** Present on the TOP-LEVEL run only. When set, a subagent tool called with
   *  `run_in_background: true` registers its detached execution here and returns
   *  an immediate ack instead of blocking; runTask drains it after the model
   *  loop settles. Absent (e.g. nested contexts) ⇒ `run_in_background` is not
   *  exposed and every call runs blocking, as before. */
  backgroundRegistry?: BackgroundSubagentRegistry;
}

// ── Shared MCP loader helper ──────────────────────────────────────────────

async function loadMcpTools(
  command: string,
  args: string[],
  prefix: string,
): Promise<{ tools: ToolDefinition[]; client: Client }> {
  // Route npx servers through the hardened provisioner: installed once into an
  // isolated, atomically-published store and launched as `node <entrypoint>` —
  // never `npx -y` at spawn time, which races on the shared ~/.npm/_npx cache
  // and rots into `ERR_MODULE_NOT_FOUND` → `MCP error -32000: Connection
  // closed`. The `npx --no-install` playwright path passes through untouched
  // (its leading flag means no package spec is parsed); non-npx commands too.
  const launch = await provisionStdioCommand(command, args);
  const transport = new StdioClientTransport({ command: launch.command, args: launch.args });
  const client = new Client({ name: "xyne-claw", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);

  // Must pass BOTH `timeout` AND `signal`: the SDK runs its own timer
  // initialised from `options.timeout ?? DEFAULT_REQUEST_TIMEOUT_MSEC` (60s).
  // Without `timeout`, that internal 60s default wins the race even if we
  // attach a generous AbortSignal. See @modelcontextprotocol/sdk
  // shared/protocol.js:712.
  const { tools } = await client.listTools(undefined, {
    timeout: MCP_REQUEST_TIMEOUT_MS,
    signal: AbortSignal.timeout(MCP_REQUEST_TIMEOUT_MS),
  });
  const toolDefs: ToolDefinition[] = tools.map((t) => ({
    name: `${prefix}__${t.name}`,
    label: `${prefix} / ${t.name}`,
    description: t.description ?? `${prefix} tool: ${t.name}`,
    parameters: Type.Unsafe(t.inputSchema ?? { type: "object", properties: {} }),
    async execute(_toolCallId: string, params: unknown) {
      // Same dual-timeout pattern as listTools above — see comment there for why.
      const result = await client.callTool(
        { name: t.name, arguments: params as Record<string, unknown> },
        undefined,
        { timeout: MCP_REQUEST_TIMEOUT_MS, signal: AbortSignal.timeout(MCP_REQUEST_TIMEOUT_MS) },
      );
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
  subagentProviderMode?: "parent" | "spaces" | "fast-model" | undefined;
  subagentProviders?: Record<string, string> | undefined;
  providerConfigs?: Record<string, { apiKey: string; model: string; baseUrl?: string; authType?: string }> | undefined;
}

/**
 * Returns (provider, providerConfig) for a subagent, or undefined to fall back to shared LITELLM.
 *
 * The Anthropic-OAuth special-case (parent on Pro/Max OAuth token → force subagent
 * inner-LLM to LiteLLM, XYNE_SUBAGENT_FOLLOW_PARENT override) is gone: Claude OAuth
 * was removed because subscription tokens must not be stored on a third-party
 * server — Claude credentials are API-key-only now, so subagents can follow the parent.
 */
function resolveProviderForSubagent(
  def: SubagentDefinition,
  resolution: SubagentProviderResolution | undefined,
): { provider: string; config: CopilotConfig | ClaudeConfig | CodexConfig } | undefined {
  const explicit = resolution?.subagentProviders?.[def.name];
  const chosen = explicit ?? resolution?.parentProvider;
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
  // Tag the description so the parent LLM can tell subagent wrappers apart
  // from direct MCP tools. The "[Subagent]" marker is what the parent's
  // PARENT_PARALLELISM_PREAMBLE refers to when it says "subagent calls are
  // expensive" — without the tag the rule has no concrete anchor.
  const taggedDescription =
    `[Subagent — nested LLM run, expensive] ${def.description} ` +
    `(If you have multiple independent questions for this subagent, batch them into ONE call with a single combined question; ` +
    `if you must fire it more than once, fire ALL the calls in the SAME assistant turn so they run in parallel.)`;
  const tool: ToolDefinition & { progressLabels?: string[] } = {
    name: def.name,
    label: def.name,
    description: taggedDescription,
    progressLabels: def.progressLabels,
    parameters: Type.Object({
      [def.paramName]: Type.String({ description: def.paramDescription }),
      // Only exposed on the top-level run (where a background registry exists).
      // Lets the parent fire this subagent non-blocking; its result is delivered
      // back automatically before the parent finishes (runTask's drain loop).
      ...(progressCtx?.backgroundRegistry
        ? {
            run_in_background: Type.Optional(
              Type.Boolean({
                description:
                  "Run this subagent in the BACKGROUND (non-blocking). You get an immediate acknowledgement and keep working; its result is delivered back to you automatically before you finish your reply. Use for slow, independent work you can overlap with other tools/subagents. Leave unset when you need the result to decide your very next step. Do NOT poll for it.",
              }),
            ),
          }
        : {}),
      // Follow-up handle. Only exposed when this subagent opts in via
      // def.supportsFollowUp. When the parent passes the `session_id` a PRIOR
      // call of THIS subagent returned, the follow-up question runs INSIDE that
      // same child session (full prior context) instead of a fresh one.
      ...(def.supportsFollowUp
        ? {
            session_id: Type.Optional(
              Type.String({
                description:
                  "Optional. To ask THIS subagent a follow-up WITH the full context of a previous call, pass the `session_id` that the previous call of THIS SAME subagent returned. Omit to start a fresh session. Never pass a session_id that a DIFFERENT subagent returned.",
              }),
            ),
          }
        : {}),
    }),
    async execute(_toolCallId: string, params: unknown) {
      const question = (params as Record<string, string>)[def.paramName] ?? "";
      // Optional follow-up handle: resume the SAME child session (full prior
      // context) instead of a fresh one. Only honoured when the def opts in,
      // and only after the handle passes a strict single-path-segment check so
      // it can never be used for path traversal.
      const rawFollowUpId = def.supportsFollowUp
        ? (params as Record<string, unknown>)["session_id"]
        : undefined;
      const followUpId = isValidFollowUpHandle(rawFollowUpId) ? rawFollowUpId : undefined;
      if (typeof rawFollowUpId === "string" && rawFollowUpId.length > 0 && !followUpId) {
        log.warn(`[${def.name}] Ignoring malformed session_id handle — starting a fresh session`);
      }
      const execStartedAt = Date.now();
      log.info(`[${def.name}] Subagent start t=${execStartedAt} call=${_toolCallId.slice(0,8)}: ${question.slice(0, 100)}`);

      // ── Background (non-blocking) spawn. If the parent asked for
      // run_in_background AND this run has a background registry (top-level
      // only), kick doExecute() off DETACHED, register it, and return an
      // immediate ack so the parent's turn continues. runTask drains the
      // registry after the model loop settles and injects the result back
      // (agent.ts). Deliberately BYPASSES memoization — a background spawn is an
      // explicit, intentional fan-out, not a dedupe candidate.
      if ((params as Record<string, unknown>)["run_in_background"] === true && progressCtx?.backgroundRegistry) {
        const promise = doExecute();
        const task: BackgroundSubagentTask = {
          taskId: _toolCallId,
          subagentName: def.name,
          question,
          startedAt: execStartedAt,
          status: "running",
          promise,
          delivered: false,
        };
        // Record terminal status off the detached promise; the attached handler
        // also prevents an unhandled-rejection crash (the drain loop reads
        // task.result/task.error, never the raw promise).
        promise.then(
          (r) => {
            task.status = "completed";
            task.result = (r.content?.[0] as { text?: string } | undefined)?.text ?? "";
          },
          (err) => {
            task.status = "error";
            task.error = err instanceof Error ? err.message : String(err);
          },
        );
        progressCtx.backgroundRegistry.set(_toolCallId, task);
        log.info(`[${def.name}] Spawned in background (task=${_toolCallId.slice(0, 8)})`);
        return {
          content: [{
            type: "text" as const,
            text:
              `Started "${def.name}" in the background (task ${_toolCallId}). It is running now — ` +
              `continue with other work. Its result will be delivered to you automatically before you ` +
              `finish your reply; do NOT block on it or poll for it.`,
          }],
          details: {},
        };
      }

      // ── (D) Memoization: identical (subagent, question) inside the same
      // parent run resolves to the SAME promise, so concurrent duplicate
      // calls share one execution and sequential duplicates skip the work
      // entirely. Skipped when there is no parentSessionId — without a
      // bounded scope we'd risk cross-run pollution.
      const parentSid = progressCtx?.parentSessionId;
      // Follow-ups are stateful and must NEVER dedupe against a prior fresh call
      // (or against each other) — bypass the memo cache when a session_id is in
      // play so each resume actually runs against the evolving child session.
      if (parentSid && !followUpId) {
        const subMap = subagentResultCache.get(parentSid) ?? new Map<string, CachedEntry>();
        if (!subagentResultCache.has(parentSid)) subagentResultCache.set(parentSid, subMap);
        const key = subagentCacheKey(def.name, question);
        const existing = subMap.get(key);
        if (existing) {
          log.info(`[${def.name}] Cache hit (parent=${parentSid.slice(0,8)} key=${key.slice(0,8)}) — sharing in-flight/completed result`);
          return existing.promise;
        }
        // Stash the in-flight promise BEFORE awaiting so a concurrent caller
        // with the same key sees it. The real execution continues below; we
        // wrap it in an inner async IIFE so we can await it as the cached promise.
        const exec = (async (): Promise<SubagentExecResult> => {
          return await doExecute();
        })();
        subMap.set(key, { promise: exec, insertedAt: Date.now() });
        return exec;
      }
      return await doExecute();

      // The body below — extracted as a closure so the cache wrapper can call
      // it once and share the resulting promise. No behaviour change inside.
      async function doExecute(): Promise<SubagentExecResult> {

      // Sticky-label state hoisted out of the try block so the catch handler
      // can clear the timer on early failures without leaking the interval.
      let stickyLabel: string | null = null;
      let sessionRef: unknown = null;
      // Declared before the try so the finally can release it. Guards concurrent
      // follow-up resumes that share one persisted child session directory.
      let releaseFollowUpLock: (() => void) | null = null;
      let toolBudget: ToolBudgetTracker | null = null;
      // Hoisted so the finally can clean it up regardless of success/error.
      let childSkillScope: string | null = null;
      const toolsUsed: string[] = [];
      // Raw child tool outputs that contain inline citation tokens — appended
      // verbatim to the returned text (below) so the parent always has the exact
      // [clf-…#n] tokens to cite, independent of how the inner LLM summarized.
      const citedToolOutputs: string[] = [];
      // Child `spaces-fetch-attachment` calls persist files into the parent workspace.
      // Capture their deterministic file markers here and append them to the wrapper
      // result so the parent can pass `{{file:.context/...}}` to a later MCP tool
      // (for example GitHub `upload-pr-attachment`) without routing base64 through
      // either LLM.
      const subagentArtifacts: SubagentArtifact[] = [];
      let turnStartedAt: number | null = null;
      let firstDeltaAt: number | null = null;
      let turnStreamChars = 0;
      let turnStreamThinkingChars = 0;
      let turnStreamTextChars = 0;
      let turnStreamCount = 0;
      let streamWindowCount = 0;
      let streamWindowStartedAt: number | null = null;
      let streamRateTimer: ReturnType<typeof setInterval> | null = null;
      let turnStreamRateSamples: Array<{ offsetMs: number; streamsPerSec: number; streamsCollected: number }> = [];
      let lastStreamCharsPerSec: number | undefined;
      let lastAssistantStreamSummary: {
        streamChars?: number;
        streamThinkingChars?: number;
        streamTextChars?: number;
        streamCharsPerSec?: number;
        streamsCollected?: number;
        streamRateSamples?: Array<{ offsetMs: number; streamsPerSec: number; streamsCollected: number }>;
      } | null = null;
      const debugEvents: SubagentDebugEvent[] = [];
      let debugSeq = 0;
      let providerError: string | null = null;
      const pushDebugEvent = (kind: string, data: Record<string, unknown> = {}, toolCallId?: string): void => {
        const event = {
          seq: ++debugSeq,
          at: new Date().toISOString(),
          kind,
          ...(toolCallId ? { toolCallId } : {}),
          data,
        };
        debugEvents.push(event);
        if (progressCtx) {
          pushDebugProgress(progressCtx.progressUrl, progressCtx.parentSessionId, {
            ...event,
            kind: kind as DebugEventRecord["kind"],
            parentToolCallId: _toolCallId,
            subagentName: def.name,
          });
        }
      };
      const pushLiveStreamRate = (streamsPerSec: number, active: boolean): void => {
        if (!progressCtx) return;
        pushDebugProgress(progressCtx.progressUrl, progressCtx.parentSessionId, {
          seq: ++debugSeq,
          at: new Date().toISOString(),
          kind: "stream_rate",
          parentToolCallId: _toolCallId,
          subagentName: def.name,
          data: { streamsPerSec, streamsCollected: turnStreamCount, active },
        });
      };
      const flushStreamRate = (active: boolean): void => {
        if (streamWindowStartedAt == null || firstDeltaAt == null) return;
        const now = Date.now();
        const elapsedMs = Math.max(1, now - streamWindowStartedAt);
        const streamsPerSec = Math.round((streamWindowCount / (elapsedMs / 1000)) * 10) / 10;
        if (streamWindowCount > 0) {
          turnStreamRateSamples.push({ offsetMs: now - firstDeltaAt, streamsPerSec, streamsCollected: turnStreamCount });
        }
        pushLiveStreamRate(streamsPerSec, active);
        streamWindowCount = 0;
        streamWindowStartedAt = now;
      };
      const startStreamRateTimer = (): void => {
        if (streamRateTimer) return;
        streamWindowStartedAt = Date.now();
        streamRateTimer = setInterval(() => flushStreamRate(true), 1_000);
      };
      const stopStreamRateTimer = (): void => {
        if (streamRateTimer) clearInterval(streamRateTimer);
        streamRateTimer = null;
        flushStreamRate(false);
        streamWindowStartedAt = null;
      };
      const snapshotMessages = (): unknown[] => {
        const messages = (sessionRef as { messages?: unknown[] } | null)?.messages ?? [];
        try {
          return JSON.parse(JSON.stringify(messages)) as unknown[];
        } catch {
          return messages;
        }
      };
      const stickyTimer = progressCtx?.progressUrl
        ? setInterval(() => {
            if (stickyLabel && progressCtx.progressUrl) {
              pushChildLabel(progressCtx.progressUrl, progressCtx.parentSessionId, stickyLabel);
            }
          }, 4_000)
        : null;

      try {
        const authStorage = AuthStorage.create();
        const modelRegistry = ModelRegistry.create(authStorage);

        // Apply copilot proxy (no-op for other providers) then register model via the same helper the parent uses
        const effectiveConfig = await applyCopilotProxyIfNeeded(resolvedProvider?.provider, resolvedProvider?.config);
        // fast-model is EXPLICIT opt-in (no faster grid model exists yet —
        // fast-mode-plan.md Slice A deferred 2026-07-15). Default/undefined/
        // "spaces" all keep today's LITELLM.model routing.
        const litellmFallbackModel =
          providerResolution?.subagentProviderMode === "fast-model"
            ? LITELLM.fastModel
            : LITELLM.model;
        const model = resolveModel(modelRegistry, resolvedProvider?.provider, effectiveConfig, {
          model: resolvedProvider ? undefined : litellmFallbackModel,
        });
        log.info(`[${def.name}] Using provider=${resolvedProvider?.provider ?? "litellm"} model=${resolvedProvider?.config.model ?? litellmFallbackModel}`);

        // Materialize skills onto disk so the child session loads them as
        // proper pi resources (same path the parent takes in agent.ts),
        // not as inlined markdown in the system prompt. This makes skill
        // triggers + the skill-resource API available inside the child
        // model loop. Scope by parent session + this tool call so
        // concurrent subagent invocations don't stomp on each other.
        childSkillScope = `${progressCtx?.parentSessionId ?? "subagent"}-${def.name}-${_toolCallId.slice(0, 8)}`;
        const childSkillsDir = skills && skills.length > 0
          ? await writeSessionSkills(childSkillScope, skills)
          : null;

        // agentDir is required on v0.75 DefaultResourceLoaderOptions under
        // exactOptionalPropertyTypes. Pi defaults the SDK to ~/.pi/agent.
        const childResourceLoader = new DefaultResourceLoader({
          cwd: process.cwd(),
          agentDir: `${process.env["HOME"] ?? "."}/.pi/agent`,
          // Same compaction policy the parent installs (agent.ts): the fresh-start
          // correction + copilot-context preservation. Subagents are the WORST
          // case for pi's keep-whole-window thrash — their context is dominated by
          // huge spaces-search/tool results with no user/assistant cut point in the
          // keep-recent budget, so without this they re-compact almost immediately.
          extensionFactories: [compactionExtension],
          ...(childSkillsDir ? { additionalSkillPaths: [childSkillsDir] } : {}),
        });
        await childResourceLoader.reload();

        // Skills live outside childWorkingDir; allow each loaded skill's dir (+
        // the session-skills dir) as READ-ONLY roots so the subagent can read
        // SKILL.md without the gate denying it. Mirrors agent.ts. Write stays
        // confined to childWorkingDir.
        //
        // Over-large MCP/retrieval results a subagent produces spill to the
        // PARENT conversation's session dir: mcp.ts promoteIfOversized() writes
        // to toolOutputDir, which run.ts froze as
        // toolOutputBaseDir(conversationId, …) = sessionDir(RAW conversationId).
        // The child is handed that ABSOLUTE path + "read it", but its file-tool
        // gate is rooted at workspaces/<sessionId> (a SIBLING of sessions/), so
        // the read was denied ("… is outside the session working directory").
        // Mirror the parent's fix (agent.ts) — allow ONLY that conversation's
        // `.context` subdir as a READ-ONLY root; the rest of the session dir
        // (transcript / debug) stays out of reach and write stays confined.
        // parentMeta.conversationId is the RAW id — matches run.ts's spill dir
        // exactly, incl. branched runs (both ignore piSessionConversationId).
        const sessionContextRoot = progressCtx?.parentMeta?.conversationId
          ? join(sessionDir(progressCtx.parentMeta.conversationId), ".context")
          : null;
        const childSkillReadRoots = Array.from(
          new Set<string>([
            ...(childSkillsDir ? [childSkillsDir] : []),
            ...(sessionContextRoot ? [sessionContextRoot] : []),
            ...childResourceLoader
              .getSkills()
              .skills.map((s) => (s as { filePath?: string }).filePath)
              .filter((p): p is string => typeof p === "string" && isAbsolute(p))
              .map((p) => dirname(p)),
          ]),
        );

        const parentSessionId = progressCtx?.parentSessionId;
        const childWorkingDir = parentSessionId ? workspacePath(parentSessionId) : process.cwd();

        // ── Follow-up session persistence. When this subagent supports
        // follow-ups AND we have a conversation to scope under, the child
        // session is PERSISTED in its own per-handle directory beneath the
        // parent conversation's session dir. That directory is picked up by the
        // existing recursive session archiver (session-store walk), so a
        // resumed follow-up survives across turns/pods for free — no new GCS
        // pipeline. Without a conversationId (nested/anon runs) or when the def
        // opts out, fall back to the original in-memory session (no resume).
        const followUpConversationId = progressCtx?.parentMeta?.conversationId;
        const followUpEnabled = !!(def.supportsFollowUp && followUpConversationId);
        let followUpHandle: string | null = null;
        let followUpResumed = false;
        let childSessionManager: SessionManager;
        if (followUpEnabled) {
          followUpHandle = followUpId ?? crypto.randomUUID();
          // Root strictly under THIS conversation's session dir + this def's
          // name. A handle minted by another conversation or subagent simply
          // won't exist here, so continueRecent starts a fresh session rather
          // than reading a foreign one — structural cross-tenant isolation.
          const childSessionRoot = join(
            sessionDir(followUpConversationId!),
            "subagents",
            def.name,
            followUpHandle,
          );
          const { mkdir } = await import("node:fs/promises");
          await mkdir(childSessionRoot, { recursive: true });
          // Serialize any concurrent resume of the same handle before we open it.
          releaseFollowUpLock = await acquireFollowUpLock(childSessionRoot);
          if (followUpId) {
            childSessionManager = SessionManager.continueRecent(childWorkingDir, childSessionRoot);
            followUpResumed = true;
            log.info(`[${def.name}] Resuming follow-up session handle=${followUpHandle}`);
          } else {
            childSessionManager = SessionManager.create(childWorkingDir, childSessionRoot);
            log.info(`[${def.name}] Created persistent follow-up session handle=${followUpHandle}`);
          }
        } else {
          childSessionManager = SessionManager.inMemory();
        }
        // Same allowlist-must-include-customTools subtlety as agent.ts —
        // pi v0.75 treats `tools` as a global allowlist that filters
        // customTools too. Listing only the 5 built-ins would silently
        // drop every MCP tool the subagent needs.
        const subagentCustomNames = (tools ?? []).map((t) => t.name);
        const { session } = await createAgentSession({
          model,
          // Per-subagent reasoning override (def.thinkingLevel) wins over the
          // global AGENT.thinkingLevel — retrieval subagents ask for "high",
          // cheap structured-fetch ones can stay low. Falls back to the global
          // default when the def doesn't pin a level.
          thinkingLevel: (def.thinkingLevel ?? AGENT.thinkingLevel) as ThinkingLevel,
          // Subagent gets the same restricted built-in set as the parent
          // (no bash) PLUS every customTool name so they aren't filtered. The
          // file-tool names are served by cwd-GATED versions registered in
          // customTools below (NOT pi's unscoped built-ins) — see agent.ts for
          // the cross-session-read rationale. Critical here too: childWorkingDir
          // falls back to process.cwd() (the container root), so without gating
          // a subagent's read/grep could walk the whole container.
          tools: ["read", "write", "grep", "find", "ls", ...subagentCustomNames],
          cwd: childWorkingDir,
          sessionManager: childSessionManager,
          authStorage,
          modelRegistry,
          // cwd-scoped file tools (override pi's unscoped read/write/grep/find/
          // ls built-ins — the cross-session-read fix) FIRST, then the
          // subagent's MCP/custom tools with oversized-output capping. The
          // scoped file tools are primitives and must NOT be capped.
          customTools: [
            ...Object.values(createScopedToolMap(childWorkingDir, childSkillReadRoots)),
            ...capCustomToolOutput(tools, childWorkingDir),
          ] as ToolDefinition[],
          resourceLoader: childResourceLoader,
        });
        sessionRef = session;
        installLlmCallMetrics(session.agent, parentSessionId ?? `subagent-${def.name}`);
        toolBudget = installToolBudget(session.agent, {
          sessionId: parentSessionId ?? `subagent-${def.name}`,
          budgetScale: 0.5,
        });

        // Mid-turn compaction + the assistant-tail resume guard (mirrors agent.ts).
        // Without this the child never checks the tool_result that just landed
        // before the NEXT prompt, and a false-overflow resume can crash the child
        // with "Cannot continue from message role: assistant". See mid-turn-compaction.ts.
        installMidTurnCompaction(session);

        pushDebugEvent("session_start", {
          parentSessionId,
          parentToolCallId: _toolCallId,
          subagentName: def.name,
          question,
          questionChars: question.length,
        });
        // Track in-flight child tool calls so we can emit full ToolInvocation objects on _end.
        const childInflight = new Map<string, { toolName: string; args: unknown; startedAt: number }>();
        session.subscribe((event) => {
          // Capture provider errors so a failed inner LLM call (Anthropic 400,
          // quota, schema, auth, etc.) surfaces back to the parent instead of
          // being masked as "(No findings)". Both message_end and turn_end
          // carry the same errorMessage; we just keep the latest non-null.
          try {
            const e = event as Record<string, unknown>;
            const msg = (e["message"] as Record<string, unknown> | undefined);
            if (msg && msg["stopReason"] === "error" && typeof msg["errorMessage"] === "string") {
              providerError = msg["errorMessage"] as string;
            }
          } catch {
            // ignore
          }
          if (event.type === "tool_execution_start") {
            turnStartedAt = null;
            firstDeltaAt = null;
            log.info(`[${def.name}] Tool: ${event.toolName}`);
            childInflight.set(event.toolCallId, { toolName: event.toolName, args: event.args, startedAt: Date.now() });
            pushDebugEvent("tool_execution_start", {
              toolName: event.toolName,
              args: (() => {
                try { return JSON.parse(JSON.stringify(event.args ?? {})); }
                catch { return event.args ?? {}; }
              })(),
            }, event.toolCallId);
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

            // Capture the raw text of any child tool result that carries inline
            // citation tokens (e.g. `[clf-abc123#14]`). The text we return to
            // the parent below is only getLastAssistantText() — the inner LLM's
            // summary, which can paraphrase away or mangle tokens. Stash the
            // verbatim token-bearing chunks so we can append the ones the
            // summary dropped, guaranteeing the parent has exact tokens to cite.
            try {
              const resStr =
                typeof event.result === "string" ? event.result : JSON.stringify(event.result);
              // Generic id match (mirrors agent.ts CITE_RE) — toolCallIds vary
              // by provider, so match any non-delimiter run instead of an
              // allow-list that would silently drop new id formats.
              if (resStr && /\[clf-[^#\s[\]]+#\d+\]/i.test(resStr)) {
                citedToolOutputs.push(resStr);
              }
              const artifact = parseSubagentArtifact(event.toolName, resStr);
              if (artifact) {
                subagentArtifacts.push(artifact);
              }
            } catch { /* ignore non-serializable results */ }

            // Tier 2: stream nested child invocation up to the parent's progressUrl
            // so the frontend can render it under the subagent row.
            if (progressCtx) {
              const started = childInflight.get(event.toolCallId);
              if (started) {
                // Persist exactly what the child model saw. Subagent inner
                // tools already go through capCustomToolOutput/promoteIfOversized
                // (see the customTools wiring above), so the result is bounded
                // in-execute. No second persist-only slice here — that re-cut the
                // already-capped result, shrinking the DB/UI copy below what the
                // model reasoned over and corrupting the MCP JSON envelope.
                const resultStr = (() => {
                  try {
                    if (typeof event.result === "string") return event.result;
                    return JSON.stringify(event.result);
                  } catch {
                    return String(event.result);
                  }
                })();
                const childInv: ToolInvocation = {
                  toolName: event.toolName,
                  args: started.args,
                  result: resultStr,
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
              }
            }
            const started = childInflight.get(event.toolCallId);
            turnStartedAt = Date.now();
            firstDeltaAt = null;
            pushDebugEvent("tool_execution_end", {
              toolName: event.toolName,
              args: (() => {
                try { return JSON.parse(JSON.stringify(started?.args ?? {})); }
                catch { return started?.args ?? {}; }
              })(),
              result: (() => {
                try {
                  return typeof event.result === "string" ? event.result : JSON.stringify(event.result);
                } catch {
                  return String(event.result);
                }
              })(),
              isError: event.isError,
              durationMs: started ? Date.now() - started.startedAt : undefined,
            }, event.toolCallId);
            childInflight.delete(event.toolCallId);
          }
          if (event.type === "message_update") {
            const ame = (event as { assistantMessageEvent?: { type?: string; delta?: string } }).assistantMessageEvent;
            if (ame && typeof ame.delta === "string" && ame.delta.length > 0) {
              if (firstDeltaAt == null && turnStartedAt != null) {
                firstDeltaAt = Date.now();
              }
              if (ame.type === "thinking_delta") {
                turnStreamCount += 1;
                streamWindowCount += 1;
                startStreamRateTimer();
                turnStreamThinkingChars += ame.delta.length;
                turnStreamChars += ame.delta.length;
              } else if (ame.type === "text_delta") {
                turnStreamCount += 1;
                streamWindowCount += 1;
                startStreamRateTimer();
                turnStreamTextChars += ame.delta.length;
                turnStreamChars += ame.delta.length;
              }
            }
          }
          if (event.type === "message_end") {
            const msg = (event as { message?: { role?: string; usage?: unknown; stopReason?: string; errorMessage?: string } }).message;
            if (msg?.role === "assistant") {
              stopStreamRateTimer();
              if (firstDeltaAt != null && turnStreamChars > 0) {
                const elapsed = Math.max(0.001, (Date.now() - firstDeltaAt) / 1000);
                lastStreamCharsPerSec = Math.round(turnStreamChars / elapsed);
              }
              pushDebugEvent("assistant_turn_end", {
                message: (() => {
                  try { return JSON.parse(JSON.stringify(msg)); }
                  catch { return msg ?? {}; }
                })(),
                usage: (() => {
                  try { return JSON.parse(JSON.stringify(msg.usage ?? {})); }
                  catch { return msg?.usage ?? {}; }
                })(),
                assistantText: session.getLastAssistantText() ?? "",
                stopReason: msg.stopReason,
                errorMessage: msg.errorMessage,
                streamChars: turnStreamChars,
                streamThinkingChars: turnStreamThinkingChars,
                streamTextChars: turnStreamTextChars,
                ...(lastStreamCharsPerSec != null ? { streamCharsPerSec: lastStreamCharsPerSec } : {}),
                streamsCollected: turnStreamCount,
                streamRateSamples: turnStreamRateSamples,
                messages: snapshotMessages(),
              });
              lastAssistantStreamSummary = {
                streamChars: turnStreamChars,
                streamThinkingChars: turnStreamThinkingChars,
                streamTextChars: turnStreamTextChars,
                ...(lastStreamCharsPerSec != null ? { streamCharsPerSec: lastStreamCharsPerSec } : {}),
                streamsCollected: turnStreamCount,
                streamRateSamples: turnStreamRateSamples,
              };
              turnStartedAt = null;
              firstDeltaAt = null;
              turnStreamChars = 0;
              turnStreamThinkingChars = 0;
              turnStreamTextChars = 0;
              turnStreamCount = 0;
              streamWindowCount = 0;
              turnStreamRateSamples = [];
              lastStreamCharsPerSec = undefined;
            }
          }
          if (event.type === "compaction_start") {
            pushDebugEvent("compaction_start", {
              reason: (event as { reason?: string }).reason,
            });
          }
          if (event.type === "compaction_end") {
            pushDebugEvent("compaction_end", {
              aborted: (event as { aborted?: boolean }).aborted,
              willRetry: (event as { willRetry?: boolean }).willRetry,
              errorMessage: (event as { errorMessage?: string }).errorMessage,
            });
          }
          if (event.type === "auto_retry_start") {
            pushDebugEvent("auto_retry_start", {
              attempt: (event as { attempt?: number }).attempt,
              maxAttempts: (event as { maxAttempts?: number }).maxAttempts,
              errorMessage: (event as { errorMessage?: string }).errorMessage,
            });
          }
        });

        // Skills are loaded via the child resourceLoader above (file-based,
        // same path the parent uses). Do NOT inline them here — duplicating
        // them in the system prompt was the old approach and bloats every
        // model call in the child loop.
        //
        // (C) Prepend the system-level subagent preamble — parallelism +
        // concision guidance applied uniformly across all subagents, not
        // per-def. Subagents flagged allowRequery (retrieval: spaces) get the
        // requery-permitting variant so the single-sweep cap doesn't choke hard
        // lookups; every other subagent keeps SUBAGENT_PREAMBLE unchanged.
        const preamble = def.allowRequery ? SUBAGENT_REQUERY_PREAMBLE : SUBAGENT_PREAMBLE;
        let systemPrompt = `${preamble}${def.systemPrompt}`;

        const childPrompt = `${systemPrompt}\n\n## Question\n${question}`;
        // On a RESUMED follow-up the child session already holds the system
        // prompt + all prior turns; re-injecting the preamble/systemPrompt would
        // bloat context and re-anchor the model. Send ONLY the new question.
        const promptText = followUpResumed ? `## Follow-up\n${question}` : childPrompt;
        pushDebugEvent("session_prompt", {
          prompt: promptText,
          messages: snapshotMessages(),
        });
        turnStartedAt = Date.now();
        firstDeltaAt = null;

        // Honour the parent run's AbortSignal. If the user cancelled before
        // we even started, stop now. Otherwise race the prompt against the
        // signal: when it fires (parent loop aborted by /cancel or client
        // disconnect), abort this child session so its pi loop unwinds and
        // any inner MCP/customTool call short-circuits at its next await
        // point. Without this, child sessions keep running past parent
        // cancel — burning tokens, spawning more inner tool calls.
        const subagentAbortSignal = progressCtx?.abortSignal;
        if (subagentAbortSignal?.aborted) {
          try {
            await (session as { abort?: () => Promise<void> | void }).abort?.();
          } catch { /* ignore */ }
          throw new Error(`${def.name} subagent cancelled before start`);
        }
        const sessionAbort = (session as { abort?: () => Promise<void> | void }).abort?.bind(session);
        const onParentAbort = () => {
          // Best-effort. The pi session has its own listener machinery; abort
          // returns whenever the SDK acknowledges. We don't await here — we
          // want the parent's catch path to take over immediately.
          try { void sessionAbort?.(); } catch { /* ignore */ }
        };
        subagentAbortSignal?.addEventListener("abort", onParentAbort, { once: true });
        try {
          await session.prompt(promptText);

          const sq = session as unknown as { _agentEventQueue?: Promise<void> };
          if (sq._agentEventQueue) await sq._agentEventQueue;
        } finally {
          subagentAbortSignal?.removeEventListener("abort", onParentAbort);
        }

        // If the inner provider raised an error AND produced no assistant text,
        // surface that error to the parent instead of pretending the search
        // came back empty. "(No findings)" was masking real failures (quota,
        // schema, auth) — the parent agent then treated absence-of-output as
        // a real negative result and looped retrying.
        const lastText = session.getLastAssistantText();
        let text: string;
        if (lastText) {
          text = lastText;
        } else if (providerError !== null) {
          // Pull out the human-readable bit from Anthropic's `400 {...json...}`
          // wrapper if present, otherwise pass through the raw error.
          const raw: string = providerError;
          const match = /"message"\s*:\s*"([^"]+)"/.exec(raw);
          const human: string = match && match[1] ? match[1] : raw;
          log.error(`[${def.name}] Provider error: ${human}`);
          text = `${def.name} subagent failed before producing any output. Provider error: ${human}`;
        } else {
          // Genuinely empty session (no tool calls, no text, no error) —
          // unusual but possible. Keep the original fallback wording so callers
          // that special-case "(No findings)" don't regress.
          text = "(No findings)";
        }

        const artifactAppendix = renderSubagentArtifacts(subagentArtifacts);
        if (artifactAppendix) {
          text += artifactAppendix;
          log.info(`[${def.name}] Appended ${subagentArtifacts.length} subagent artifact marker(s) to parent-visible result`);
        }

        // Citation-token safety net: surface any `[clf-…#n]` token from the raw
        // child tool results that the inner LLM's summary omitted, so the parent
        // can always cite verbatim even if the summary paraphrased the tokens
        // away. Self-limiting: citedToolOutputs only fills when child results
        // carried tokens (the retrieval case), so this is a no-op otherwise.
        if (citedToolOutputs.length > 0) {
          // Generic id match (mirrors agent.ts CITE_RE) — see the capture site
          // above for why an allow-list would silently drop new id formats.
          const tokenRe = /\[clf-[^#\s[\]]+#\d+\]/gi;
          const seenInText = new Set((text.match(tokenRe) ?? []).map((t) => t.toLowerCase()));
          const missing: string[] = [];
          for (const chunk of citedToolOutputs) {
            for (const tok of chunk.match(tokenRe) ?? []) {
              if (!seenInText.has(tok.toLowerCase())) {
                missing.push(tok);
                seenInText.add(tok.toLowerCase());
              }
            }
          }
          if (missing.length > 0) {
            const list = missing.slice(0, 40).join(" ");
            text += `\n\n---\n**Citation tokens available from retrieved chunks** (copy verbatim when citing; do NOT invent or range): ${list}`;
            log.info(`[${def.name}] Appended ${missing.length} citation token(s) not present in summary text`);
          }
        }

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
              log.info(`[${def.name}] Skill trigger: ${trigger.skillSlug} fired (inner tool ${innerTool} was used)`);
              text += `\n\n---\n**[Skill Injected: ${trigger.skillSlug}]** _(configured by user in agent settings)_`;
              if (trigger.prompt) text += `\nInstruction: ${trigger.prompt}`;
              text += `\n\n${trigger.skillContent}\n---`;
            }
          }
        }

        const execDurationMs = Date.now() - execStartedAt;
        log.info(`[${def.name}] Subagent end t=${Date.now()} call=${_toolCallId.slice(0,8)} duration=${execDurationMs}ms innerTools=${toolsUsed.length} chars=${text.length}`);
        pushDebugEvent("session_end", {
          durationMs: execDurationMs,
          textLength: text.length,
          toolsUsed,
          providerError,
          ...(lastAssistantStreamSummary ?? {}),
        });
        if (parentSessionId) {
          try {
            const debugDir = await ensureSessionDebugDir(progressCtx?.parentDebugSessionId ?? parentSessionId);
            const { writeFile } = await import("node:fs/promises");
            const safeToolCallId = _toolCallId.replace(/[^a-zA-Z0-9_-]/g, "-");
            const safeName = `${def.name}-${safeToolCallId}`;
            const childSnapshot = {
              schemaVersion: 1,
              parentSessionId,
              parentToolCallId: _toolCallId,
              subagentName: def.name,
              question,
              provider: resolvedProvider?.provider ?? "litellm",
              model: resolvedProvider?.config.model ?? "shared",
              startedAt: new Date(execStartedAt).toISOString(),
              finishedAt: new Date().toISOString(),
              text,
              toolsUsed,
              providerError,
              messages: snapshotMessages(),
              events: debugEvents,
              ...(lastAssistantStreamSummary ?? {}),
            };
            await writeFile(`${debugDir}/subagents-${safeName}.json`, JSON.stringify(childSnapshot, null, 2), "utf8");
          } catch (err) {
            log.warn(`[${def.name}] Failed to write child debug artifact: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        if (followUpEnabled && followUpHandle) {
          text += `\n\n---\n_Follow-up:_ to ask THIS \`${def.name}\` subagent another question WITH the full context of this run, call \`${def.name}\` again passing \`session_id: "${followUpHandle}"\`. Omit it to start fresh.`;
        }
        return {
          content: [{ type: "text" as const, text }],
          details: followUpEnabled && followUpHandle
            ? { session_id: followUpHandle, resumed: followUpResumed }
            : {},
        };
      } catch (err) {
        if (stickyTimer) clearInterval(stickyTimer);
        stopStreamRateTimer();
        const msg = err instanceof Error ? err.message : String(err);
        log.error(`[${def.name}] Failed:`, msg);
        pushDebugEvent("session_error", { error: msg });
        if (progressCtx?.parentSessionId) {
          try {
            const debugDir = await ensureSessionDebugDir(progressCtx.parentDebugSessionId ?? progressCtx.parentSessionId);
            const { writeFile } = await import("node:fs/promises");
            const safeToolCallId = _toolCallId.replace(/[^a-zA-Z0-9_-]/g, "-");
            const safeName = `${def.name}-${safeToolCallId}`;
            const childSnapshot = {
              schemaVersion: 1,
              parentSessionId: progressCtx.parentSessionId,
              parentToolCallId: _toolCallId,
              subagentName: def.name,
              question,
              provider: resolvedProvider?.provider ?? "litellm",
              model: resolvedProvider?.config.model ?? "shared",
              startedAt: new Date(execStartedAt).toISOString(),
              finishedAt: new Date().toISOString(),
              error: msg,
              toolsUsed,
              providerError,
              messages: snapshotMessages(),
              events: debugEvents,
            };
            await writeFile(`${debugDir}/subagents-${safeName}.json`, JSON.stringify(childSnapshot, null, 2), "utf8");
          } catch {
            // ignore
          }
        }
        return { content: [{ type: "text" as const, text: `${def.name} subagent failed: ${msg}` }], details: {} };
      } finally {
        // Dispose the child session even on the error path — the success path
        // already disposed it (dispose() is idempotent), but the catch path
        // didn't, leaking the session's listeners/extension context on every
        // failed subagent. Best-effort.
        try { releaseFollowUpLock?.(); } catch { /* ignore */ }
        try { (sessionRef as { dispose?: () => void } | null)?.dispose?.(); } catch { /* ignore */ }
        if (toolBudget) {
          metric.observe("tool_calls_per_run", toolBudget.calls, {
            session: progressCtx?.parentSessionId ?? `subagent-${def.name}`,
            agent: def.name,
          });
        }
        // Delete the per-invocation skills dir so it doesn't accumulate on disk.
        if (childSkillScope) await deleteSessionSkills(childSkillScope);
      }
      } // close doExecute
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

function customToolSlug(tool: ToolDefinition): string {
  const meta = tool as ToolDefinition & { slug?: string };
  return meta.slug ?? tool.name;
}

function isCustomWriteTool(tool: ToolDefinition): boolean {
  return (tool as ToolDefinition & { isWriteTool?: boolean }).isWriteTool === true;
}

/**
 * Wire-format spec for a user-created subagent, forwarded from xyne-claw-auth
 * in the `/run` body. Built-in subagents live in SUBAGENT_DEFINITIONS and
 * never travel this path.
 */
export interface CustomSubagentSpec {
  name: string;
  description: string;
  progressLabels: string[];
  systemPrompt: string;
  paramName: string;
  paramDescription: string;
  tools: { direct?: string[]; custom?: string[] };
  skills: Array<{ slug: string; name: string; description: string; content: string }>;
}

/**
 * Resolve a custom subagent's tools config to the actual ToolDefinition
 * objects that should populate the child LLM's palette. Pulls direct tools
 * out of MCP groups (matched by extracted tool name) and custom tools by
 * slug. Tools the admin didn't select are excluded.
 */
function resolveCustomSubagentTools(
  toolsConfig: { direct?: string[]; custom?: string[] },
  groups: McpToolGroup[],
  customTools: ToolDefinition[] | undefined,
): ToolDefinition[] {
  const directNames = new Set(toolsConfig.direct ?? []);
  const customSlugs = new Set(toolsConfig.custom ?? []);
  const out: ToolDefinition[] = [];

  if (directNames.size > 0) {
    for (const group of groups) {
      for (const t of group.tools) {
        const name = extractToolName(t.name);
        // Include write tools too. Their ToolDefinition still queues a signed
        // pendingAction via the parent run's MCP wrapper; it does not execute
        // until the human approval card is approved in claw-auth.
        if (directNames.has(name)) out.push(t);
      }
    }
  }
  if (customSlugs.size > 0 && customTools) {
    for (const t of customTools) {
      const slug = customToolSlug(t);
      // Custom write tools follow the same signed pendingAction path as MCP
      // writes, so custom subagents can now own the full workflow while the
      // approval gate remains outside the child LLM.
      if (customSlugs.has(slug)) out.push(t);
    }
  }
  return out;
}

/**
 * Group MCP tool groups into subagent wrappers based on serverType.
 * Also wraps custom tools whose `source` matches a subagent definition.
 * Write tools are included in the subagent palette and still use the parent
 * run's signed pendingAction approval gate; they are also hoisted as direct
 * tools for backwards compatibility with existing parent-driven approvals.
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
  // User-created subagents forwarded by xyne-claw-auth from the
  // subagent_definitions table. Processed AFTER the built-in serverType
  // matching loop so built-ins always win on name collisions (validation
  // also prevents this at create time).
  customSubagents?: CustomSubagentSpec[],
  // Tool-name SUFFIXES (e.g. ["get_pull_request", "list_pull_requests"]) the
  // user picked individually in the agent UI. When a tool's name ends with one
  // of these, it gets hoisted out of its subagent wrapper as a direct tool too
  // (the parent agent sees it alongside the subagent). The same tool stays
  // accessible inside the subagent palette, so delegating still works. Empty
  // / undefined = legacy behavior (everything stays inside the wrapper).
  directPickSuffixes?: string[],
): {
  subagentTools: ToolDefinition[];
  directTools: ToolDefinition[];
  remainingCustomTools: ToolDefinition[];
} {
  const subagentTools: ToolDefinition[] = [];
  const directTools: ToolDefinition[] = [];

  const isDirectPick = (toolName: string): boolean => {
    if (!directPickSuffixes || directPickSuffixes.length === 0) return false;
    return directPickSuffixes.some((s) => toolName.endsWith(s));
  };

  for (const group of groups) {
    const def = findSubagentDefinitionForServer(group.serverType);

    if (def) {
      const writeSet = new Set(group.writeTools.map(String));
      const writeTools = group.tools.filter((t) => writeSet.has(extractToolName(t.name)));

      if (group.tools.length > 0) {
        const skills = subagentSkills?.[def.name] ?? subagentSkills?.["__default"];
        const bonus = bonusToolsBySubagent?.[def.name] ?? [];
        subagentTools.push(makeSubagentTool(def, [...group.tools, ...bonus], skillTriggers, skills, providerResolution, progressCtx));

        // Hoist user-picked tools into the parent's direct palette too. The
        // subagent wrapper above already contains them — this just exposes a
        // second path so the parent agent can call e.g. `bitbucket__get_pull_request`
        // without going through the `bitbucket` subagent. Picked-as-direct +
        // picked-as-subagent both work; the parent-level filter in run.ts
        // decides which path actually surfaces to the model.
        const hoisted = group.tools.filter((t) => isDirectPick(t.name));
        if (hoisted.length > 0) directTools.push(...hoisted);
      }
      // Backwards compatibility: keep write tools visible at parent level for
      // agents/prompts that already perform parent-driven approval flows.
      directTools.push(...writeTools);
    } else {
      // No subagent definition for this server type — keep all as direct
      directTools.push(...group.tools);
    }
  }

  // Wrap custom tools whose `source` matches a subagent definition. NOTE:
  // sandbox tools are NOT wrapped — the sandbox subagent was removed
  // (2026-06-14) and they mount parent-direct (see routes/run.ts).
  const remainingCustomTools: ToolDefinition[] = [];
  if (customTools) {
    // Group custom tools by their `source` label.
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
      // Response-only cards stay out of the always-active set here exactly as
      // they do in buildFastModeDirectTools — routes/run.ts catalogues them
      // instead, and a name that reaches fastAlwaysActiveToolNames is filtered
      // back OUT of the catalog, which would silently make them eager again.
      // This is the non-fast-mode half of that invariant.
      if (isPresentationToolSource(source)) continue;
      const def = findSubagentDefinitionForServer(source);
      if (def && tools.length > 0) {
        const customSkills = subagentSkills?.[def.name] ?? subagentSkills?.["__default"];
        const filteredTools = tools;
        const writeTools = filteredTools.filter(isCustomWriteTool);
        const bonus = bonusToolsBySubagent?.[def.name] ?? [];
        if (filteredTools.length > 0 || bonus.length > 0) {
          subagentTools.push(makeSubagentTool(def, [...filteredTools, ...bonus], skillTriggers, customSkills, providerResolution, progressCtx));
        }

        // Same individual-pick hoist as the built-in MCP branch above: any
        // custom-source tool whose name matches a user-picked suffix also
        // gets exposed to the parent agent's direct palette. We push into
        // `directTools` (not `remainingCustomTools`) so the parent-side
        // filter in run.ts gates these via the SAME `tools.direct` suffix
        // check that bitbucket/spaces direct picks use — one config knob,
        // one mental model. The tool stays accessible inside the subagent
        // wrapper too.
        const hoisted = filteredTools.filter((t) => isDirectPick(t.name));
        if (hoisted.length > 0) directTools.push(...hoisted);
        // Backwards compatibility for existing prompts that expect custom write
        // tools to be parent-level approval tools.
        remainingCustomTools.push(...writeTools);
      } else {
        remainingCustomTools.push(...tools);
      }
    }
  }

  // ── User-created subagents (from xyne-claw-auth's subagent_definitions
  // table) — resolve each spec's tools config explicitly, build a synthetic
  // SubagentDefinition, and wrap via the same makeSubagentTool factory the
  // built-ins use. Skills travel inline on the spec and are passed straight
  // through to the wrapper (it materializes them as SKILL.md files in the
  // child session). ─────────────────────────────────────────────────────
  if (customSubagents && customSubagents.length > 0) {
    const builtinNames = new Set(SUBAGENT_DEFINITIONS.map((d) => d.name));
    for (const spec of customSubagents) {
      if (builtinNames.has(spec.name)) {
        log.warn(`[buildSubagentTools] Ignoring custom subagent "${spec.name}" — name collides with a built-in (built-in wins)`);
        continue;
      }
      const palette = resolveCustomSubagentTools(spec.tools, groups, customTools);
      if (palette.length === 0) {
        const referenced = (spec.tools.direct?.length ?? 0) + (spec.tools.custom?.length ?? 0);
        if (referenced > 0) {
          // The subagent references tools but none survived in the live MCP
          // groups. Since claw-auth's enforcement RETAINS subagent-referenced
          // servers (2026-07-08 fix), the overwhelmingly common cause is now
          // benign: the runner simply has no credentials/connection for the
          // backing server — that case was silently skipped for months and
          // logging it at error level produced ~2.7k false alarms/day
          // (2026-07-09). warn with full detail; the enforcement-regression
          // class is separately visible via claw-auth's "retained server="
          // and "enforced-drop" log lines.
          log.warn(
            `[buildSubagentTools] Custom subagent "${spec.name}" resolved to 0 tools despite referencing ${referenced} (direct=${spec.tools.direct?.length ?? 0} custom=${spec.tools.custom?.length ?? 0}) — skipping (no creds for its server, or dropped upstream); available groups: [${groups.map((g) => g.serverType).join(",")}]`,
          );
        } else {
          log.warn(`[buildSubagentTools] Custom subagent "${spec.name}" resolved to 0 tools — skipping (check its tools config against live MCP groups)`);
        }
        continue;
      }
      const syntheticDef: SubagentDefinition = {
        name: spec.name,
        description: spec.description,
        progressLabels: spec.progressLabels,
        systemPrompt: spec.systemPrompt,
        paramName: spec.paramName,
        paramDescription: spec.paramDescription,
        // Synthetic serverType — never matched against an MCP group. Kept
        // distinct from any real serverType so the "find by serverType"
        // loops above don't accidentally re-process this entry.
        serverType: `custom-defined:${spec.name}`,
      };
      const bonus = bonusToolsBySubagent?.[spec.name] ?? [];
      subagentTools.push(
        makeSubagentTool(
          syntheticDef,
          [...palette, ...bonus],
          skillTriggers,
          spec.skills,
          providerResolution,
          progressCtx,
        ),
      );
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
    log.info(`[deepwiki] Loaded ${tools.length} tools: ${tools.map((t) => t.name).join(", ")}`);
    return cachedDeepwikiTools;
  } catch (err) {
    log.warn(`[deepwiki] Failed to load tools: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

let cachedContext7Tools: McpToolGroup | null = null;

export async function loadContext7Tools(): Promise<McpToolGroup | null> {
  if (cachedContext7Tools) return cachedContext7Tools;
  try {
    const { tools } = await loadMcpTools("npx", ["-y", "@upstash/context7-mcp@latest"], "context7");
    cachedContext7Tools = { serverType: "context7", serverName: "context7", tools, writeTools: [] };
    log.info(`[context7] Loaded ${tools.length} tools: ${tools.map((t) => t.name).join(", ")}`);
    return cachedContext7Tools;
  } catch (err) {
    log.warn(`[context7] Failed to load tools: ${err instanceof Error ? err.message : err}`);
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
    // Use the globally-installed @playwright/mcp from the Dockerfile rather
    // than `npx -y @playwright/mcp@latest`. The latter:
    //   - hits the npm registry on every spawn to resolve @latest,
    //   - writes into the shared /home/claw/.npm/_npx/<hash>/ cache,
    //   - and has no locking between concurrent spawns, so two parallel
    //     conversations can race the install and leave the cache half-deleted
    //     (ENOTEMPTY on rmdir → next spawn sees missing coreBundle.js).
    // `npx --no-install` resolves the binary from $PATH (where the global
    // install lives) without ever touching the _npx cache.
    const { tools } = await loadMcpTools(
      "npx",
      ["--no-install", "@playwright/mcp", "--headless", "--isolated"],
      "playwright",
    );
    cachedPlaywrightTools = { serverType: "playwright", serverName: "playwright", tools, writeTools: [] };
    log.info(`[playwright] Loaded ${tools.length} tools: ${tools.map((t) => t.name).join(", ")}`);
    return cachedPlaywrightTools;
  } catch (err) {
    log.warn(`[playwright] Failed to load tools: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}
