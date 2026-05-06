/**
 * Bridge between xyne-claw-shared tool definitions and pi-coding-agent ToolDefinitions.
 * Config resolution order: agentConfig → env var → tool default
 *
 * Write tools (isWriteTool: true) require user approval — they produce a pendingAction
 * instead of executing immediately, matching the MCP write-tool flow.
 */

import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { getAllCustomTools, type ToolExecutionContext, type PendingQuestion, type PendingResponse } from "xyne-claw-shared";
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
// followed by `\n<additional text>`. Base64 is constrained to one line so any
// content after the first newline following the marker line is the tool's own
// text result (e.g. create-ppt returns the slide JSON for edit-ppt to consume).
const ATTACHMENT_RE = /^\[ATTACHMENT:([^:]+):([^\]]+)\]\n([A-Za-z0-9+/=]+)(?:\n([\s\S]*))?$/;
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
  userId: string,
  serverType: string,
  tool: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const url = `${SERVER.authServiceUrl}/claw/api/v1/users/${encodeURIComponent(userId)}/actions/sign`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
}

export function loadCustomTools(
  agentConfig?: Record<string, unknown>,
  meta?: Record<string, string>,
  onAttachment?: (a: Attachment) => void,
  researchContext?: { type: string; id?: string; name: string; repositoryId?: string; productId?: string },
  progressUrl?: string,
  sessionId?: string,
  s2sKey?: string,
  parentToolCallId?: string,
): CustomToolsResult {
  const agentSlug = meta?.["agentSlug"];
  const userId = meta?.["userId"] ?? "";
  const allCustomTools = getAllCustomTools();
  const config = agentConfig ?? {};

  // Filter tools by agent — restrict certain tool sets to specific agent
  const customTools = allCustomTools.filter((ct) => {
    let allowed = true;
    if (ct.source === "custom:pgm") allowed = agentSlug === "pgm-agent";
    else if (ct.source === "custom:google") allowed = agentSlug === "google-agent";
    else if (ct.source === "custom:microsoft") allowed = agentSlug === "microsoft-agent";
    else if (ct.source === "custom:research-agent") allowed = agentSlug === "research-agent" || agentSlug === "ask-ai";
    else if (ct.source === "custom:web-search") allowed = agentSlug === "ask-ai" && String(config["webSearchEnabled"]) === "true";
    else if (ct.source === "custom:deep-research") allowed = agentSlug === "ask-ai" && String(config["deepResearchEnabled"]) === "true";
    else if (ct.source === "custom:generate-image") allowed = agentSlug === "ask-ai";
    
    return allowed;
  });
  const allAttachments: Attachment[] = [];
  const allPendingQuestions: PendingQuestion[] = [];
  const allPendingActions: Array<Record<string, unknown>> = [];
  const allPendingResponses: PendingResponse[] = [];

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
    };

    return {
      name: ct.slug,
      label: ct.name,
      description: ct.description,
      source: ct.source,
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
            const serverType = ct.source.replace("custom:", "");
            const signedAction = await signWriteAction(userId, serverType, ct.slug, params as Record<string, unknown>);
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

        // Check for embedded attachment
        const match = result.match(ATTACHMENT_RE);
        if (match) {
          // Extract structured slide JSON (if present) and stash on the
          // attachment's metadata. This travels on the callback payload as
          // `attachments[i].metadata` and is safe from the 10KB tool-result
          // truncation applied by pi-coding-agent.
          const trailingText = match[4]?.trim();
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
            fileName: match[1]!,
            mimeType: match[2]!,
            data: match[3]!,
            ...(Object.keys(metadata).length ? { metadata } : {}),
          };
          allAttachments.push(attachment);
          try { onAttachment?.(attachment); } catch (err) {
            console.warn(`[custom-tool] ${ct.slug} onAttachment callback threw:`, err instanceof Error ? err.message : err);
          }
          // Preserve any trailing text the tool added after the attachment (e.g.
          // create-ppt returns the slide JSON so edit-ppt can modify it).
          const responseText = trailingText && trailingText.length > 0
            ? `Rendered and attached ${match[1]}\n\n${trailingText}`
            : `Rendered and attached ${match[1]}`;

          // For image MIME types, ALSO push the image bytes into the calling
          // agent's tool-result content. That makes the model visually see
          // the screenshot in its next turn (same pattern pi-coding-agent's
          // built-in `read` tool uses for image files), so a subagent that
          // just took a screenshot via sandbox-read-file can self-verify the
          // UI claim instead of paraphrasing the text confirmation. Without
          // this, the sandbox subagent's model only ever sees "Rendered and
          // attached foo.png" and is forced to claim success blindly.
          const isImage = match[2]!.startsWith("image/");
          if (isImage) {
            return {
              content: [
                { type: "text" as const, text: responseText },
                { type: "image" as const, data: match[3]!, mimeType: match[2]! },
              ],
              details: {},
            };
          }
          return {
            content: [{ type: "text" as const, text: responseText }],
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
  };
}
