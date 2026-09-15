/**
 * The bot-identity send tool, granted per-run to awakened (heartbeat / reflex)
 * runs.
 *
 * `apps-send-message` is deliberately absent from the agent tool picker — it
 * posts as the bot rather than as the human — so a strict `tools.direct`
 * allowlist always excludes it. For an awakened run that is fatal rather than
 * merely restrictive: nobody is in a thread to receive the agent's final
 * answer, so this tool is its only voice.
 *
 * The grant has to be applied in TWO places, because two independent gates
 * filter the palette: claw-auth's MCP listing (routes/mcp.ts) and claw's own
 * re-filter against the forwarded agent config (applyAgentToolFilter in
 * xyne-claw/src/routes/run.ts). Both are per-run and in-memory; the stored
 * agent config is never modified and interactive runs are unaffected.
 */

export const AWAKENING_SEND_TOOL = "apps-send-message";

function withTool(direct: unknown, toolName: string): string[] {
  const existing = Array.isArray(direct)
    ? direct.filter((value): value is string => typeof value === "string")
    : [];
  return existing.includes(toolName) ? existing : [...existing, toolName];
}

/** Append the send tool to `tools.direct` of a full agent config record. */
export function withAwakeningSendTool(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const tools = (config["tools"] as Record<string, unknown> | undefined) ?? {};
  return {
    ...config,
    tools: { ...tools, direct: withTool(tools["direct"], AWAKENING_SEND_TOOL) },
  };
}
