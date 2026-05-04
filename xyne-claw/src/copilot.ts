/**
 * Copilot mode support — builds the respond-to-user tool as a
 * pi-coding-agent ToolDefinition for injection into copilot sessions.
 */

import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { respondToUser, type PendingResponse, type ToolExecutionContext } from "xyne-claw-shared";

/**
 * Builds a pi-coding-agent ToolDefinition for respond-to-user,
 * wired to the shared pendingResponses collector.
 */
export function buildCopilotTool(
  getPendingResponses: () => PendingResponse[],
): ToolDefinition {
  // The shared pendingResponses array is the same reference
  const pendingResponses = getPendingResponses();

  const context: ToolExecutionContext = {
    config: {},
    pendingResponses,
  };

  return {
    name: respondToUser.slug,
    label: respondToUser.name,
    description: respondToUser.description,
    parameters: Type.Unsafe(respondToUser.inputSchema),
    async execute(_toolCallId: string, params: unknown) {
      const result = await respondToUser.execute(
        params as Record<string, unknown>,
        context,
      );
      console.log(`[copilot] respond-to-user: ${result.slice(0, 200)}`);
      return {
        content: [{ type: "text" as const, text: result }],
        details: {},
      };
    },
  };
}
