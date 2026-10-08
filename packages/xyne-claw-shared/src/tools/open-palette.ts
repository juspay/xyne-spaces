import { classifyToolRisk, type ToolRiskLevel } from "./tool-risk.js";

/**
 * Per-agent opt-in that lets an agent reach tools nobody granted it. Off by
 * default; widens the grant enforced independently in claw-auth's MCP
 * listing, claw-auth's call gate, and claw's resolver — all three, not one.
 *
 * `true` resolves to `"read"`. `"all"` also admits writes; destructive tools
 * are refused at every setting.
 */
export type OpenPaletteMode = "off" | "read" | "all";

const TOOLS_KEY = "tools";
const FLAG_KEY = "openPalette";

/** Reads the flag off an already-extracted `config.tools`. Anything
 *  unrecognised reads as off — a typo must not widen a boundary. */
export function openPaletteModeFromTools(toolsConfig: unknown): OpenPaletteMode {
  const raw = (toolsConfig as Record<string, unknown> | null | undefined)?.[FLAG_KEY];
  if (raw === true || raw === "read") return "read";
  if (raw === "all") return "all";
  return "off";
}

export function openPaletteMode(agentConfig: unknown): OpenPaletteMode {
  return openPaletteModeFromTools((agentConfig as Record<string, unknown> | null | undefined)?.[TOOLS_KEY]);
}

/**
 * Whether the open palette covers this tool. Destructive tools are never
 * covered, at any setting — the code can't tell "forgot to grant" from
 * "decided not to grant", so it refuses.
 */
export function openPaletteAdmits(mode: OpenPaletteMode, toolName: string, isWrite?: boolean): boolean {
  if (mode === "off") return false;
  const risk: ToolRiskLevel = classifyToolRisk(toolName, isWrite);
  if (risk === "destructive") return false;
  return mode === "all" || risk === "read";
}
