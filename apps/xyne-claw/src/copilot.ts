/**
 * Copilot mode support — builds the respond-to-user tool as a
 * pi-coding-agent ToolDefinition for injection into copilot sessions.
 */

import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { respondToUser, type PendingResponse, type ToolExecutionContext } from "xyne-claw-shared";

import { createLogger } from "./logger.js";
const log = createLogger("copilot");

/**
 * Builds a pi-coding-agent ToolDefinition for respond-to-user,
 * wired to the shared pendingResponses collector.
 */
export function buildCopilotTool(
  getPendingResponses: () => PendingResponse[],
  abortRun?: () => void,
): ToolDefinition {
  // The shared pendingResponses array is the same reference
  const pendingResponses = getPendingResponses();

  const context: ToolExecutionContext = {
    config: {},
    pendingResponses,
    ...(abortRun ? { abortRun } : {}),
  };

  return {
    name: respondToUser.slug,
    label: respondToUser.name,
    description: respondToUser.description,
    parameters: Type.Unsafe(respondToUser.inputSchema),
    async execute(_toolCallId: string, params: unknown) {
      // Log the actual user-facing message BEFORE executing the tool, so
      // we can see what the agent intended to say even if pendingResponses
      // post fails downstream. `result` below is the tool's STOP return
      // value, not the user-visible content — that one is in params.message.
      const message = (params as Record<string, unknown> | undefined)?.["message"];
      const preview = typeof message === "string" ? message : "(non-string message)";
      log.info(
        `[copilot] respond-to-user message (${typeof message === "string" ? message.length : 0} chars): ${preview.slice(0, 300).replace(/\n/g, " ")}`,
      );
      const result = await respondToUser.execute(
        params as Record<string, unknown>,
        context,
      );
      log.info(`[copilot] respond-to-user tool returned: ${result.slice(0, 200)}`);
      return {
        content: [{ type: "text" as const, text: result }],
        details: {},
      };
    },
  };
}
