/**
 * Bridge between xyne-claw-shared tool definitions and pi-coding-agent ToolDefinitions.
 * Config resolution order: agentConfig → env var → tool default
 *
 * Write tools (isWriteTool: true) require user approval — they produce a pendingAction
 * instead of executing immediately, matching the MCP write-tool flow.
 */

import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { getAllCustomTools, parseToolsConfig, PLATFORM_ONLY_CONFIG_KEYS, type ToolExecutionContext, type PendingQuestion, type PendingResponse } from "xyne-claw-shared";
import { SERVER, PATHS } from "./config.js";
import { join } from "node:path";

import { createLogger } from "./logger.js";
import { SandboxUnavailableError, isSandboxUnavailableDeferEnabled, isSandboxUnavailable } from "./sandbox-unavailable.js";
const log = createLogger("custom-tools");

const ARCHITECTURE_REVIEW_FORBIDDEN_COMMANDS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /(?:^|[;&|]\s*)\s*(?:rm|mv|cp|touch|mkdir|rmdir|truncate|chmod|chown|tee|install)\b/i, label: "filesystem mutation" },
  { pattern: /(?:^|[;&|]\s*)\s*(?:node|python\d*|ruby|perl|php|bash|sh|zsh|fish)\b/i, label: "interpreter execution" },
  { pattern: /(?:^|[;&|]\s*)\s*(?:npm|pnpm|yarn|bun|npx|make|cmake|cargo|go|gradle|mvn)\b/i, label: "package, build, or script execution" },
  { pattern: /(?:^|[;&|]\s*)\s*(?:curl|wget|nc|netcat|ssh|scp|rsync)\b/i, label: "network or copy command" },
  { pattern: /\bgit\s+(?:checkout|switch|reset|clean|add|commit|push|pull|fetch|merge|rebase|cherry-pick|revert|apply|am|tag|init|clone|gc|prune|worktree)\b/i, label: "Git mutation" },
  { pattern: /\bgit\s+[^\n]*(?:--output(?:=|\s)|--ext-diff\b|--textconv\b)/i, label: "Git output or external command execution" },
  { pattern: /\bsed\b[^\n]*\s-i\b/i, label: "in-place edit" },
  { pattern: /\bfind\b[^\n]*(?:-delete|-exec|-execdir|-ok|-okdir|-fprint|-fprintf|-fls)\b/i, label: "mutating find" },
  { pattern: /(?:^|[^<])>{1,2}(?!>)/, label: "output redirection" },
  { pattern: /`|\$|~|[<>]\(/, label: "shell expansion" },
  { pattern: /(?:^|\s)[^\s]*\.git(?:\/|\s|$)/i, label: "Git metadata access" },
];

export function validateArchitectureReviewSandboxCommand(command: string): string | undefined {
  if (!command.trim()) return "Architecture review sandbox commands must not be empty.";
  for (const { pattern, label } of ARCHITECTURE_REVIEW_FORBIDDEN_COMMANDS) {
    if (pattern.test(command)) return `Architecture review is read-only: blocked ${label}.`;
  }
  const allowedCommands = new Set(["cd", "pwd", "git", "sed", "cat", "grep", "find", "ls"]);
  const allowedGitCommand = /^git\s+(?:diff|show|log|status|merge-base|rev-parse)\b/i;
  for (const segment of command.split(/&&|\|\||[;&|\n]/)) {
    const trimmed = segment.trim();
    const executable = trimmed.match(/^([A-Za-z0-9_.-]+)/)?.[1];
    if (executable && !allowedCommands.has(executable)) {
      return `Architecture review is read-only: command ${executable} is outside the inspection allowlist.`;
    }
    if (executable === "cd" && trimmed !== "cd /workspace/xyne-spaces") {
      return "Architecture review is read-only: cd is limited to /workspace/xyne-spaces.";
    }
    if (executable !== "cd" && /(?:^|\s)(?:\/|\.\.(?:\/|\s|$))/.test(trimmed)) {
      return "Architecture review is read-only: paths must stay inside the repository workspace.";
    }
    if (executable === "git" && !allowedGitCommand.test(trimmed)) {
      return "Architecture review is read-only: Git command is outside the inspection allowlist.";
    }
    if (executable === "sed" && !/^sed\s+-n\s+(?:['"]\d+(?:,\d+)?p['"]|\d+(?:,\d+)?p)\s+.+$/.test(trimmed)) {
      return "Architecture review is read-only: sed is limited to numeric print ranges.";
    }
  }
  return undefined;
}

interface Attachment {
  fileName: string;
  mimeType: string;
  data: string;
  /** Optional structured metadata carried alongside the file bytes — e.g.
   *  create-ppt/edit-ppt stash the full slide JSON here so the dashboard
   *  viewer can render it without relying on the tool-result text (which
   *  gets truncated by pi-coding-agent at 10KB). */
  metadata?: Record<string, unknown>;
}

// Attachment marker: `[ATTACHMENT:<name>:<mime>]\n<base64-single-line>` optionally
// followed by `\n<additional text>` (which may be more attachments — supports
// delivering N files in a single tool result).
//
// Single-attachment regex (anchored) preserved for the trailing-text contract
// that create-ppt/edit-ppt rely on (SLIDE_JSON travels in the trailing text).
const ATTACHMENT_RE = /^\[ATTACHMENT:([^:]+):([^\]]+)\]\n([A-Za-z0-9+/=]+)(?:\n([\s\S]*))?$/;
// Multi-attachment scanner: matches every `[ATTACHMENT:name:mime]\n<base64>`
// block in the result. Lazy on the trailing newline so subsequent markers stop
// the base64 capture cleanly. Used for tools like `sandbox-deliver-files`
// that emit multiple files in one call.
const ATTACHMENT_GLOBAL_RE = /\[ATTACHMENT:([^:\]]+):([^\]]+)\]\n([A-Za-z0-9+/=]+)/g;
// Self-inspection marker: `[INSPECT:name:mime]\n<base64>`. Like ATTACHMENT but
// the bytes are routed ONLY into the agent's tool-result content blocks (so
// the model can see the image) — they are NOT pushed into allAttachments and
// will NOT be delivered to the user. Use when the agent needs to look at a
// file for self-verification without leaking it to the chat thread.
const INSPECT_RE = /^\[INSPECT:([^:\]]+):([^\]]+)\]\n([A-Za-z0-9+/=]+)(?:\n([\s\S]*))?$/;
const SLIDE_JSON_RE = /SLIDE_JSON_START\s*([\s\S]+?)\s*SLIDE_JSON_END/;
// create-react-artifact's manifest marker. Same contract as SLIDE_JSON: the
// artifact's FULL source rides the attachment bytes, while this small manifest
// (title/entry/file paths/dep names) travels here so it lands on
// ChatAttachment.metadata for the dashboard's inline card. Unlike SLIDE_JSON it
// is also stripped from the text handed back to the model — the model just
// authored the project and re-reading a listing of it buys nothing.
const REACT_ARTIFACT_RE = /REACT_ARTIFACT_START\s*([\s\S]+?)\s*REACT_ARTIFACT_END/;

// PLATFORM_ONLY_CONFIG_KEYS is imported from xyne-claw-shared (single source of
// truth — also enforced at the xyne-claw-auth /run boundary). See that module
// for why each key must resolve from env only.

function resolveToolConfig(
  toolConfigSchema: Record<string, { default: string }> | undefined,
  agentConfig: Record<string, unknown>,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(agentConfig)) {
    // Platform-only keys must NEVER come from agentConfig — not even keys a tool
    // doesn't declare in its schema (the second loop below only guards declared
    // keys). Skipping them here forces env/default sourcing and closes the
    // secret-exfil / SSRF / GIT_SSH_COMMAND-injection bypass.
    if (PLATFORM_ONLY_CONFIG_KEYS.has(key)) continue;
    if (typeof value === "string") resolved[key] = value;
  }
  if (!toolConfigSchema) return resolved;
  for (const [key, field] of Object.entries(toolConfigSchema)) {
    const agentVal = agentConfig[key];
    // Platform-only keys can never be overridden from agentConfig — env/default
    // only — so a hostile agent config can't redirect internal calls or
    // exfiltrate platform secrets.
    if (!PLATFORM_ONLY_CONFIG_KEYS.has(key) && typeof agentVal === "string" && agentVal.length > 0) {
      resolved[key] = agentVal;
    } else if (process.env[key]) {
      resolved[key] = process.env[key]!;
    } else {
      resolved[key] = field.default;
    }
  }
  return resolved;
}

/**
 * Sign a write-tool action via the auth service so it can be verified on approval.
 */
async function signWriteAction(
  sessionId: string,
  sessionToken: string,
  serverType: string,
  tool: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const url = `${SERVER.authServiceUrl}/claw/api/v1/sessions/${encodeURIComponent(sessionId)}/actions/sign`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionToken}`,
      // S2S key alongside the run's session token — claw-auth's
      // /sessions/:id/* routes require both (see routes/mcp.ts).
      "x-s2s-key": SERVER.s2sKey,
    },
    body: JSON.stringify({ serverType, tool, params }),
  });
  const body = (await res.json()) as { success: boolean; data?: Record<string, unknown>; error?: string };
  if (!body.success || !body.data) {
    throw new Error(body.error ?? `Failed to sign action: ${res.status}`);
  }
  return body.data;
}


export interface CustomToolsResult {
  tools: ToolDefinition[];
  getAttachments: () => Attachment[];
  getPendingQuestions: () => PendingQuestion[];
  getPendingActions: () => Array<Record<string, unknown>>;
  getPendingResponses: () => PendingResponse[];
  /**
   * The most recent user-visible summary text emitted by an attachment-
   * producing tool (e.g. create-html-report's `summary` parameter, or the
   * "Delivered N files: …" line from sandbox-deliver-files). Used by run.ts
   * to rescue runs where the agent calls an attachment tool and then ends
   * its turn with no chat-visible text — Spaces hides empty messages and
   * shows a fallback apology, which is worse than showing the summary.
   * Null when no attachment tool ran or none emitted trailing text.
   */
  getLastAttachmentSummary: () => string | null;
}

export function loadCustomTools(
  agentConfig?: Record<string, unknown>,
  meta?: Record<string, string>,
  onAttachment?: (a: Attachment) => void,
  researchContext?: { type: string; id?: string; name: string; repositoryId?: string; productId?: string },
  progressUrl?: string,
  sessionId?: string,
  s2sKey?: string,
  sessionToken?: string,
  parentToolCallId?: string,
  providerConfig?: ToolExecutionContext["providerConfig"],
  emitUiWidget?: ToolExecutionContext["emitUiWidget"],
  forcedCustomSlugs: readonly string[] = [],
): CustomToolsResult {
  const agentSlug = meta?.["agentSlug"];
  const userId = meta?.["userId"] ?? "";
  const allCustomTools = getAllCustomTools();
  const config = agentConfig ?? {};


  // Determine which custom tool slugs the agent has explicitly selected via
  // its tools config (set in the agent edit UI). When set, we use it to gate
  // tool sets that aren't tied to a specific agent slug — primarily Google
  // and Microsoft, which only need their OAuth token to be available.
  const toolsConfig = parseToolsConfig(agentConfig ?? undefined);
  const selectedCustom = new Set([
    ...(toolsConfig?.custom ?? []),
    ...forcedCustomSlugs,
  ]);
  const forcedCustom = new Set(forcedCustomSlugs);
  // Google + Microsoft are no longer loaded as in-process custom tools — they
  // run as claw-auth-hosted stdio MCP connectors (type "google"/"microsoft"),
  // resolved through the normal MCP credential path. See mcp/servers/google-server.ts
  // and mcp/adapters/google.ts in xyne-claw-auth. The custom:google/custom:microsoft
  // defs are filtered out below.
  const hasResearchAgentSelected = [...selectedCustom].some((s) =>
    s === "query-codebase" || s === "review-pull-request" || s.startsWith("research-agent-"),
  );
  // Sandbox tools (sandbox-create / sandbox-run / sandbox-write-file /
  // sandbox-pw-* / etc.) mount directly on the parent. The sandbox subagent
  // was removed (2026-06-14) and every agent that used it was migrated to list
  // the sandbox-* slugs in `tools.custom` — so selection is now simply "any
  // sandbox-* slug present." (The old `tools.subagents: ["sandbox"]` OR-branch
  // is gone; nothing writes that anymore.)
  const hasSandboxSelected = [...selectedCustom].some((s) => s.startsWith("sandbox-"));

  // Filter tools by agent — google/microsoft/research-agent are allowed
  // for any agent whose config selects at least one of those tools (or the
  // built-in agent slugs for backward compat).
  const customTools = allCustomTools.filter((ct) => {
    let allowed = true;
    // Google + Microsoft migrated to claw-auth stdio MCP connectors — never
    // load them as in-process custom tools anymore.
    if (ct.source === "custom:google" || ct.source === "custom:microsoft") allowed = false;
    // Auth-executed System Tools are surfaced via /mcp/tools with selectionKey
    // gating; loading them in-process would create duplicate tool names.
    else if (ct.source === "custom:orchestrator" || ct.source === "custom:agent-introspect" || ct.source === "custom:webfetch") allowed = false;
    else if (ct.source === "custom:research-agent") allowed = agentSlug === "research-agent" || agentSlug === "ask-ai" || hasResearchAgentSelected;
    // web-search / deep-research are unrestricted — any agent gets them.
    // Removed the prior agentSlug + config-flag gate per request.
    else if (ct.source === "custom:generate-image") allowed = agentSlug === "ask-ai" || forcedCustom.has(ct.slug);
    else if (ct.source === "custom:sandbox") allowed = hasSandboxSelected;

    return allowed;
  });
  const allAttachments: Attachment[] = [];
  const allPendingQuestions: PendingQuestion[] = [];
  const allPendingActions: Array<Record<string, unknown>> = [];
  const allPendingResponses: PendingResponse[] = [];

  // One widget publisher for every custom tool. Legacy runs POST the same
  // typed envelope to progressUrl; SSE runs inject an in-process emitter from
  // routes/run.ts. Widget implementations never need to know which transport
  // is active, and future widgets do not require more plumbing here.
  const publishUiWidget: ToolExecutionContext["emitUiWidget"] = emitUiWidget ?? (
    progressUrl && sessionId
      ? async (widget) => {
          const response = await fetch(progressUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(s2sKey ? { "x-s2s-key": s2sKey } : {}),
            },
            body: JSON.stringify({
              sessionId,
              kind: "ui-widget",
              widget,
              ...(meta?.["conversationId"] ? { conversationId: meta["conversationId"] } : {}),
              ...(meta?.["agentSlug"] ? { agentSlug: meta["agentSlug"] } : {}),
            }),
            signal: AbortSignal.timeout(15_000),
          });
          if (!response.ok) {
            const detail = await response.text().catch(() => "");
            throw new Error(`UI widget delivery failed: HTTP ${response.status}${detail ? ` ${detail.slice(0, 160)}` : ""}`);
          }
        }
      : undefined
  );

  // Captures the user-visible summary text emitted alongside each
  // [ATTACHMENT:...] block. When the agent's final assistant turn comes back
  // empty AND we delivered an attachment, the run.ts result handler promotes
  // this to result.text so Spaces shows something instead of the "I wasn't
  // able to produce a response" fallback. Stays null when no attachment-tool
  // ran or none of them included trailing text.
  let lastAttachmentSummary: string | null = null;

  // Pin the agent's configured sandbox repo (agent.config.sandboxRepo) into the
  // tool meta. sandbox-repo-setup reads context.meta.sandboxRepo and, when set,
  // forces THAT repo regardless of the repoName the LLM passes — making the repo
  // selection deterministic (set once in the agent UI, enforced here).
  const pinnedSandboxRepo = typeof agentConfig?.["sandboxRepo"] === "string"
    ? (agentConfig["sandboxRepo"] as string).trim()
    : "";
  // Absolute root of THIS run's materialized skills (`<dataDir>/session-skills/<sessionId>`).
  // Injected so `sandbox-copy-in` can stream a skill's companion file into the
  // sandbox server-side, confined to this root (mirrors the agent's skill read root).
  const skillsRoot = sessionId ? join(PATHS.dataDir, "session-skills", sessionId) : "";
  const toolMeta: Record<string, string> | undefined = (meta || pinnedSandboxRepo || skillsRoot)
    ? {
        ...(meta ?? {}),
        ...(pinnedSandboxRepo ? { sandboxRepo: pinnedSandboxRepo } : {}),
        ...(skillsRoot ? { skillsRoot } : {}),
      }
    : undefined;

  const tools = customTools.map((ct) => {
    const resolvedConfig = resolveToolConfig(ct.configSchema, config);
    const context: ToolExecutionContext = {
      config: resolvedConfig,
      ...(toolMeta ? { meta: toolMeta } : {}),
      ...(providerConfig ? { providerConfig } : {}),
      ...(researchContext ? { researchContext } : {}),
      pendingQuestions: allPendingQuestions,
      pendingResponses: allPendingResponses,
      ...(progressUrl ? { progressUrl } : {}),
      ...(publishUiWidget ? { emitUiWidget: publishUiWidget } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(s2sKey ? { s2sKey } : {}),
      ...(sessionToken ? { sessionToken } : {}),
    };

    return {
      name: ct.slug,
      label: ct.name,
      description: ct.description,
      source: ct.source,
      slug: ct.slug,
      isWriteTool: ct.isWriteTool === true,
      parameters: Type.Unsafe(ct.inputSchema),
      async execute(_toolCallId: string, params: unknown) {
        // Pass the framework-assigned tool call ID into the context
        // so child tools (like research agent) can nest their invocations under this parent
        const toolContext: ToolExecutionContext = {
          ...context,
          toolCallId: _toolCallId,
        };
        if (meta?.["taskCommand"] === "/architecture-review") {
          const input = params as Record<string, unknown>;
          if (ct.slug === "sandbox-repo-setup" && input["write"] !== false) {
            return {
              content: [{ type: "text" as const, text: "Error: /architecture-review requires sandbox-repo-setup with write=false." }],
              details: {},
            };
          }
          if (ct.slug === "sandbox-run") {
            const error = validateArchitectureReviewSandboxCommand(String(input["cmd"] ?? ""));
            if (error) {
              return {
                content: [{ type: "text" as const, text: `Error: ${error}` }],
                details: {},
              };
            }
          }
        }

        // Write tools require user approval — don't execute, produce pendingAction
        if (ct.isWriteTool) {
          try {
            if (!sessionId || !sessionToken) {
              return {
                content: [{ type: "text" as const, text: `Cannot sign write action: missing per-run session credentials.` }],
                details: {},
              };
            }
            const serverType = ct.source.replace("custom:", "");
            const signedAction = await signWriteAction(sessionId, sessionToken, serverType, ct.slug, params as Record<string, unknown>);
            allPendingActions.push(signedAction);
            log.info(`[custom-tool] ${ct.slug} is a write tool — queued for approval`);
            return {
              content: [{ type: "text" as const, text: `Action queued for user approval: ${ct.name}. The user will see an Approve/Decline prompt.` }],
              details: {},
            };
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            log.error(`[custom-tool] ${ct.slug} failed to sign write action:`, errMsg);
            return {
              content: [{ type: "text" as const, text: `Error: Could not queue action for approval — ${errMsg}` }],
              details: {},
            };
          }
        }

        let result: string;
        try {
          result = await ct.execute(params as Record<string, unknown>, toolContext);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          log.error(`[custom-tool] ${ct.slug} threw:`, errMsg);
          result = `Error: ${errMsg}`;
        }

        // Sandbox-capacity deferral (flag-gated, default off): the inner catch
        // above stringifies every tool throw and hands it to the LLM, which for a
        // failed WRITE-sandbox provision would just give up and end the run with no
        // retry signal. When sandbox-repo-setup emits the `sandbox_unavailable`
        // sentinel, rethrow a typed error so it propagates to run.ts's terminal
        // catch → run ends with error:"sandbox_unavailable" → run-recovery defers
        // and auto-resumes. See apps/xyne-claw/docs/sbx-availability-signal.md.
        if (
          isSandboxUnavailableDeferEnabled() &&
          ct.slug === "sandbox-repo-setup" &&
          isSandboxUnavailable(result)
        ) {
          log.info(`[custom-tool] ${ct.slug} sandbox_unavailable — deferring run for auto-resume`);
          throw new SandboxUnavailableError(result.slice("Error: ".length));
        }

        // INSPECT marker — image goes into agent's content for self-verification
        // but is NOT pushed to allAttachments (user does not receive the file).
        // Use case: sandbox-read-file on a screenshot the agent wants to look at
        // before deciding whether to deliver it via sandbox-deliver-files.
        const inspectMatch = result.match(INSPECT_RE);
        if (inspectMatch) {
          const fileName = inspectMatch[1]!;
          const mimeType = inspectMatch[2]!;
          const data = inspectMatch[3]!;
          const inspectionSummary = inspectMatch[4]?.trim();
          const isImage = mimeType.startsWith("image/");
          log.info(`[inspect] ${ct.slug} fileName=${fileName} mime=${mimeType} bytes=${data.length} (NOT delivered to user)`);
          if (isImage) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: inspectionSummary ||
                    `Inspected ${fileName} (visible to you only — call sandbox-deliver-files to send it to the user).`,
                },
                { type: "image" as const, data, mimeType },
              ],
              details: {},
            };
          }
          // Non-image binary: agent can't visually inspect, so just acknowledge.
          return {
            content: [{ type: "text" as const, text: `Read binary ${fileName} (${mimeType}, ${data.length} base64 bytes). Use sandbox-deliver-files to send it to the user.` }],
            details: {},
          };
        }

        // Detect attachments. Two cases:
        // 1) Single-attachment with trailing structured text (legacy contract for
        //    create-ppt/edit-ppt → SLIDE_JSON metadata, agent self-inspection
        //    via image content block).
        // 2) Multi-attachment (sandbox-deliver-files emits one block per file
        //    concatenated). Each block becomes a separate Attachment.
        const singleMatch = result.match(ATTACHMENT_RE);
        const multiMatches: RegExpMatchArray[] = [];
        // Reset the global regex's lastIndex defensively before scanning.
        ATTACHMENT_GLOBAL_RE.lastIndex = 0;
        for (const m of result.matchAll(ATTACHMENT_GLOBAL_RE)) {
          multiMatches.push(m);
        }

        // Single match path preserves the legacy SLIDE_JSON / image-block
        // self-inspection behavior for tools that return exactly one attachment
        // plus optional trailing text (create-ppt, sandbox-read-file in legacy
        // mode, etc.).
        if (singleMatch && multiMatches.length <= 1) {
          const trailingText = singleMatch[4]?.trim();
          const metadata: Record<string, unknown> = {};
          if (trailingText) {
            const slideMatch = trailingText.match(SLIDE_JSON_RE);
            if (slideMatch?.[1]) {
              try {
                metadata["slideJson"] = JSON.parse(slideMatch[1]);
              } catch (err) {
                log.warn(`[custom-tool] ${ct.slug} slide JSON parse failed:`, err instanceof Error ? err.message : err);
              }
            }
            const artifactMatch = trailingText.match(REACT_ARTIFACT_RE);
            if (artifactMatch?.[1]) {
              try {
                metadata["reactArtifact"] = JSON.parse(artifactMatch[1]);
              } catch (err) {
                log.warn(`[custom-tool] ${ct.slug} react artifact manifest parse failed:`, err instanceof Error ? err.message : err);
              }
            }
          }

          const attachment: Attachment = {
            fileName: singleMatch[1]!,
            mimeType: singleMatch[2]!,
            data: singleMatch[3]!,
            ...(Object.keys(metadata).length ? { metadata } : {}),
          };
          allAttachments.push(attachment);
          log.info(
            `[attachment] +1 ${ct.slug} fileName=${attachment.fileName} mime=${attachment.mimeType} ` +
              `bytes=${attachment.data.length} total=${allAttachments.length}`,
          );
          try { onAttachment?.(attachment); } catch (err) {
            log.warn(`[custom-tool] ${ct.slug} onAttachment callback threw:`, err instanceof Error ? err.message : err);
          }
          // Capture the user-provided summary (trailing text). Stripped of
          // any SLIDE_JSON block so the fallback text doesn't include
          // metadata the user shouldn't see.
          if (trailingText && trailingText.length > 0) {
            const visibleSummary = trailingText.replace(SLIDE_JSON_RE, "").replace(REACT_ARTIFACT_RE, "").trim();
            if (visibleSummary.length > 0) lastAttachmentSummary = visibleSummary;
          }
          // No-op for every existing tool (only create-react-artifact emits the
          // marker), so the model-facing text is unchanged for create-ppt et al.
          const modelFacingText = trailingText ? trailingText.replace(REACT_ARTIFACT_RE, "").trim() : "";
          const responseText = modelFacingText.length > 0
            ? `Rendered and attached ${singleMatch[1]}\n\n${modelFacingText}`
            : `Rendered and attached ${singleMatch[1]}`;

          const isImage = singleMatch[2]!.startsWith("image/");
          if (isImage) {
            return {
              content: [
                { type: "text" as const, text: responseText },
                { type: "image" as const, data: singleMatch[3]!, mimeType: singleMatch[2]! },
              ],
              details: {},
            };
          }
          return {
            content: [{ type: "text" as const, text: responseText }],
            details: {},
          };
        }

        // Multi-attachment path: deliver every block, return a summary text +
        // image content blocks for any image attachments so the agent can
        // self-verify what it just sent. No SLIDE_JSON/trailing-text contract
        // here — multi-delivery tools shouldn't mix structured metadata.
        if (multiMatches.length > 1) {
          const fileNames: string[] = [];
          const imageContent: Array<{ type: "image"; data: string; mimeType: string }> = [];
          for (const m of multiMatches) {
            const fileName = m[1]!;
            const mimeType = m[2]!;
            const data = m[3]!;
            const attachment: Attachment = { fileName, mimeType, data };
            allAttachments.push(attachment);
            fileNames.push(fileName);
            log.info(
              `[attachment] +1 ${ct.slug} fileName=${fileName} mime=${mimeType} ` +
                `bytes=${data.length} total=${allAttachments.length}`,
            );
            try { onAttachment?.(attachment); } catch (err) {
              log.warn(`[custom-tool] ${ct.slug} onAttachment callback threw:`, err instanceof Error ? err.message : err);
            }
            if (mimeType.startsWith("image/")) {
              imageContent.push({ type: "image" as const, data, mimeType });
            }
          }
          const summary = `Delivered ${fileNames.length} file(s) to the user: ${fileNames.join(", ")}`;
          lastAttachmentSummary = summary;
          return {
            content: [
              { type: "text" as const, text: summary },
              ...imageContent,
            ],
            details: {},
          };
        }

        return {
          content: [{ type: "text" as const, text: result }],
          details: {},
        };
      },
    };
  });

  return {
    tools,
    getAttachments: () => allAttachments,
    getPendingQuestions: () => allPendingQuestions,
    getPendingActions: () => allPendingActions,
    getPendingResponses: () => allPendingResponses,
    getLastAttachmentSummary: () => lastAttachmentSummary,
  };
}
