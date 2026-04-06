/**
 * Bridge between xyne-claw-shared tool definitions and pi-coding-agent ToolDefinitions.
 * Config resolution order: agentConfig → env var → tool default
 */

import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { getAllCustomTools, type ToolExecutionContext, type PendingQuestion } from "xyne-claw-shared";

interface Attachment {
  fileName: string;
  mimeType: string;
  data: string;
}

const ATTACHMENT_RE = /^\[ATTACHMENT:([^:]+):([^\]]+)\]\n([\s\S]+)$/;

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

export interface CustomToolsResult {
  tools: ToolDefinition[];
  getAttachments: () => Attachment[];
  getPendingQuestions: () => PendingQuestion[];
}

export function loadCustomTools(
  agentConfig?: Record<string, unknown>,
  meta?: Record<string, string>,
): CustomToolsResult {
  const agentSlug = meta?.["agentSlug"];
  const allCustomTools = getAllCustomTools();

  // Filter tools by agent — pgm tools only for pgm-agent
  const customTools = allCustomTools.filter((ct) => {
    if (ct.source === "custom:pgm") return agentSlug === "pgm-agent";
    return true;
  });
  const config = agentConfig ?? {};
  const allAttachments: Attachment[] = [];
  const allPendingQuestions: PendingQuestion[] = [];

  const tools = customTools.map((ct) => {
    const resolvedConfig = resolveToolConfig(ct.configSchema, config);
    const context: ToolExecutionContext = {
      config: resolvedConfig,
      ...(meta ? { meta } : {}),
      pendingQuestions: allPendingQuestions,
    };

    return {
      name: ct.slug,
      label: ct.name,
      description: ct.description,
      parameters: Type.Unsafe(ct.inputSchema),
      async execute(_toolCallId: string, params: unknown) {
        const result = await ct.execute(params as Record<string, unknown>, context);

        // Check for embedded attachment
        const match = result.match(ATTACHMENT_RE);
        if (match) {
          allAttachments.push({
            fileName: match[1]!,
            mimeType: match[2]!,
            data: match[3]!,
          });
          return {
            content: [{ type: "text" as const, text: `Rendered and attached ${match[1]}` }],
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
  };
}
