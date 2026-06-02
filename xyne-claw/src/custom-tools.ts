/**
 * Bridge between xyne-claw-shared tool definitions and pi-coding-agent ToolDefinitions.
 * Config resolution order: agentConfig → env var → tool default
 *
 * Write tools (isWriteTool: true) require user approval — they produce a pendingAction
 * instead of executing immediately, matching the MCP write-tool flow.
 */

import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { getAllCustomTools, parseToolsConfig, type ToolExecutionContext, type PendingQuestion, type PendingResponse } from "xyne-claw-shared";
import { SERVER } from "./config.js";

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
const INSPECT_RE = /^\[INSPECT:([^:\]]+):([^\]]+)\]\n([A-Za-z0-9+/=]+)$/;
const SLIDE_JSON_RE = /SLIDE_JSON_START\s*([\s\S]+?)\s*SLIDE_JSON_END/;

function resolveToolConfig(
  toolConfigSchema: Record<string, { default: string }> | undefined,
  agentConfig: Record<string, unknown>,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  if (!toolConfigSchema) return resolved;
  for (const [key, field] of Object.entries(toolConfigSchema)) {
    const agentVal = agentConfig[key];
    if (typeof agentVal === "string" && agentVal.length > 0) {
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
  const selectedCustom = new Set(toolsConfig?.custom ?? []);
  const hasGoogleSelected = [...selectedCustom].some((s) => s.startsWith("google-"));
  const hasMicrosoftSelected = [...selectedCustom].some((s) => s.startsWith("microsoft-"));
  const hasWorkloadSelected = [...selectedCustom].some((s) => s.startsWith("workload-"));

  // Filter tools by agent — pgm and research-agent stay slug-locked because
  // they assume a specific agent environment; google/microsoft are allowed for
  // any agent whose config selects at least one of those tools (or the
  // built-in google-agent / microsoft-agent slugs for backward compat).
  const customTools = allCustomTools.filter((ct) => {
    let allowed = true;
    if (ct.source === "custom:pgm") allowed = agentSlug === "pgm-agent";
    else if (ct.source === "custom:google") allowed = agentSlug === "google-agent" || hasGoogleSelected;
    else if (ct.source === "custom:microsoft") allowed = agentSlug === "microsoft-agent" || hasMicrosoftSelected;
    else if (ct.source === "custom:research-agent") allowed = agentSlug === "research-agent" || agentSlug === "ask-ai";
    // web-search / deep-research are unrestricted — any agent gets them.
    // Removed the prior agentSlug + config-flag gate per request.
    else if (ct.source === "custom:generate-image") allowed = agentSlug === "ask-ai";
    else if (ct.source === "custom:workload") allowed = hasWorkloadSelected || agentSlug === "workload-agent";
    
    return allowed;
  });
  const allAttachments: Attachment[] = [];
  const allPendingQuestions: PendingQuestion[] = [];
  const allPendingActions: Array<Record<string, unknown>> = [];
  const allPendingResponses: PendingResponse[] = [];

  // Captures the user-visible summary text emitted alongside each
  // [ATTACHMENT:...] block. When the agent's final assistant turn comes back
  // empty AND we delivered an attachment, the run.ts result handler promotes
  // this to result.text so Spaces shows something instead of the "I wasn't
  // able to produce a response" fallback. Stays null when no attachment-tool
  // ran or none of them included trailing text.
  let lastAttachmentSummary: string | null = null;

  const tools = customTools.map((ct) => {
    const resolvedConfig = resolveToolConfig(ct.configSchema, config);
    const context: ToolExecutionContext = {
      config: resolvedConfig,
      ...(meta ? { meta } : {}),
      ...(researchContext ? { researchContext } : {}),
      pendingQuestions: allPendingQuestions,
      pendingResponses: allPendingResponses,
      ...(progressUrl ? { progressUrl } : {}),
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
            console.log(`[custom-tool] ${ct.slug} is a write tool — queued for approval`);
            return {
              content: [{ type: "text" as const, text: `Action queued for user approval: ${ct.name}. The user will see an Approve/Decline prompt.` }],
              details: {},
            };
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            console.error(`[custom-tool] ${ct.slug} failed to sign write action:`, errMsg);
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
          console.error(`[custom-tool] ${ct.slug} threw:`, errMsg);
          result = `Error: ${errMsg}`;
        }
        console.log(`[custom-tool] ${ct.slug} result: ${result.slice(0, 300)}`);

        // INSPECT marker — image goes into agent's content for self-verification
        // but is NOT pushed to allAttachments (user does not receive the file).
        // Use case: sandbox-read-file on a screenshot the agent wants to look at
        // before deciding whether to deliver it via sandbox-deliver-files.
        const inspectMatch = result.match(INSPECT_RE);
        if (inspectMatch) {
          const fileName = inspectMatch[1]!;
          const mimeType = inspectMatch[2]!;
          const data = inspectMatch[3]!;
          const isImage = mimeType.startsWith("image/");
          console.log(`[inspect] ${ct.slug} fileName=${fileName} mime=${mimeType} bytes=${data.length} (NOT delivered to user)`);
          if (isImage) {
            return {
              content: [
                { type: "text" as const, text: `Inspected ${fileName} (visible to you only — call sandbox-deliver-files to send it to the user).` },
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
                console.warn(`[custom-tool] ${ct.slug} slide JSON parse failed:`, err instanceof Error ? err.message : err);
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
          console.log(
            `[attachment] +1 ${ct.slug} fileName=${attachment.fileName} mime=${attachment.mimeType} ` +
              `bytes=${attachment.data.length} total=${allAttachments.length}`,
          );
          try { onAttachment?.(attachment); } catch (err) {
            console.warn(`[custom-tool] ${ct.slug} onAttachment callback threw:`, err instanceof Error ? err.message : err);
          }
          // Capture the user-provided summary (trailing text). Stripped of
          // any SLIDE_JSON block so the fallback text doesn't include
          // metadata the user shouldn't see.
          if (trailingText && trailingText.length > 0) {
            const visibleSummary = trailingText.replace(SLIDE_JSON_RE, "").trim();
            if (visibleSummary.length > 0) lastAttachmentSummary = visibleSummary;
          }
          const responseText = trailingText && trailingText.length > 0
            ? `Rendered and attached ${singleMatch[1]}\n\n${trailingText}`
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
            console.log(
              `[attachment] +1 ${ct.slug} fileName=${fileName} mime=${mimeType} ` +
                `bytes=${data.length} total=${allAttachments.length}`,
            );
            try { onAttachment?.(attachment); } catch (err) {
              console.warn(`[custom-tool] ${ct.slug} onAttachment callback threw:`, err instanceof Error ? err.message : err);
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
