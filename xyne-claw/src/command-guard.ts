/**
 * Global command guard for xyne-claw agents.
 * Blocks destructive shell commands via pi-agent-core's beforeToolCall hook.
 */

import type { BeforeToolCallContext, BeforeToolCallResult } from "@earendil-works/pi-agent-core";

import { createLogger } from "./logger.js";
const log = createLogger("command-guard");

const BLOCKED_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\brm\s+-rf\b/, label: "rm -rf" },
  { pattern: /\brm\s+.*-r/, label: "rm -r" },
  { pattern: /\bgit\s+push\s+--force(?!-with-lease)\b/, label: "git push --force" },
  { pattern: /\bgit\s+push\s+-f\b/, label: "git push -f" },
  { pattern: /\bgit\s+reset\s+--hard\b/, label: "git reset --hard" },
  { pattern: /\bgit\s+clean\s+-f/, label: "git clean -f" },
  { pattern: /\bchmod\s+777\b/, label: "chmod 777" },
  { pattern: /\bcurl\s+.*\|\s*(?:ba)?sh\b/, label: "curl | sh" },
  { pattern: /\bwget\s+.*\|\s*(?:ba)?sh\b/, label: "wget | sh" },
  { pattern: /\bmkfs\b/, label: "mkfs" },
  { pattern: /\bdd\s+if=/, label: "dd" },
  { pattern: /\b:\(\)\s*\{/, label: "fork bomb" },
  { pattern: />\s*\/dev\/sd/, label: "write to disk device" },
  { pattern: /\bnpm\s+publish\b/, label: "npm publish" },
];

function checkCommand(command: string): { blocked: boolean; label?: string } {
  for (const { pattern, label } of BLOCKED_PATTERNS) {
    if (pattern.test(command)) {
      return { blocked: true, label };
    }
  }
  return { blocked: false };
}

export function createCommandGuard(): (context: BeforeToolCallContext, signal?: AbortSignal) => Promise<BeforeToolCallResult | undefined> {
  return async (context) => {
    const toolName = context.toolCall.name;

    // Only guard bash/shell tool calls
    if (toolName !== "bash" && toolName !== "shell") {
      return undefined;
    }

    const args = context.args as Record<string, unknown>;
    const command = (args["command"] as string) ?? "";

    const result = checkCommand(command);
    if (result.blocked) {
      log.warn(`[guard] Blocked command (${result.label}): ${command.slice(0, 200)}`);
      return {
        block: true,
        reason: `Command blocked by safety guard: "${result.label}" is not allowed. Use the appropriate tool instead (e.g., pgm-* tools for git operations).`,
      };
    }

    return undefined;
  };
}
