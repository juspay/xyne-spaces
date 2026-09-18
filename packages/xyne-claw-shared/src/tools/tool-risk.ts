/**
 * How dangerous a tool is. Shared by three places that must not drift: the
 * Toolbox risk badge, the tool index's `risk:` tag, and the ceiling
 * `search-tools` applies at runtime.
 */

export type ToolRiskLevel = "read" | "write" | "destructive";

/** Irreversible, or reversible only by someone else. Checked first — a
 *  destructive tool is destructive whatever the write flag says. */
const DESTRUCTIVE_PATTERNS = [
  "delete", "remove", "drop", "destroy", "purge",
  "revoke", "terminate", "uninstall", "trash",
  "decline", "cancel",
];

/** Last resort when no source of record has an opinion; errs toward `write` —
 *  miscalling a read tool `write` is cheap, the reverse is not. */
const WRITE_PATTERNS = [
  "create", "update", "write", "send", "post", "add", "set",
  "edit", "upload", "insert", "patch", "move", "rename", "assign",
  "modify", "archive", "reply", "draft", "publish", "share", "invite",
  "approve", "merge", "commit", "push", "deliver", "schedule", "star",
];

/** `isWrite` is what a source of record said (a connector's `writeTools`, a
 *  registry entry's `isWriteTool`). Pass `undefined` when nothing knows —
 *  absence is not evidence of `read`. */
export function classifyToolRisk(toolName: string, isWrite?: boolean): ToolRiskLevel {
  const lower = toolName.toLowerCase();
  if (DESTRUCTIVE_PATTERNS.some((p) => lower.includes(p))) return "destructive";
  if (isWrite === true) return "write";
  if (isWrite === false) return "read";
  return WRITE_PATTERNS.some((p) => lower.includes(p)) ? "write" : "read";
}

/** Risk ladder order, so a ceiling can admit everything at or below it. */
export const TOOL_RISK_LADDER: readonly ToolRiskLevel[] = ["read", "write", "destructive"];

export function riskAtOrBelow(ceiling: ToolRiskLevel): ToolRiskLevel[] {
  return TOOL_RISK_LADDER.slice(0, TOOL_RISK_LADDER.indexOf(ceiling) + 1);
}
