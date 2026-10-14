// Decides whether a successful sandbox-* tool call should announce a live
// preview for the sandbox it used (XYNE-66338).
//
// A run can touch several sandboxes — typically the shared read-only sbx-git
// sandbox for reading code, then its own writable sandbox for the work. Each
// distinct writable sandbox is announced exactly once per run; shared /
// read-only sandboxes are never announced.

export type SandboxAnnounceDecision =
  | { announce: true; sandboxId: string }
  | { announce: false; reason: "no-session" | "tool-error" | "not-owned" | "shared-readonly" | "already-announced"; sandboxId?: string };

export interface SandboxAnnounceInput {
  /** Tool-call args; an explicit `sessionId` wins over the conversation binding. */
  toolArgs: unknown;
  /** The caller-scoped sandbox store key (the run's conversation binding). */
  storeKey: string;
  /** Sandbox IDs already announced in this run. */
  announced: ReadonlySet<string>;
  toolResult?: unknown;
  getSession: (key: string) => { id?: string } | undefined;
  isOwned: (lookupKey: string) => boolean;
  isSharedOrReadOnly: (sandboxId: string) => boolean;
}

export function toolResultText(result: unknown): string {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return "";
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : ""))
    .join("");
}

export function isRefusalToolResult(result: unknown): boolean {
  return /^\s*Error:/.test(toolResultText(result));
}

export function explicitSandboxSessionId(toolArgs: unknown): string | undefined {
  if (!toolArgs || typeof toolArgs !== "object") return undefined;
  const v = (toolArgs as { sessionId?: unknown }).sessionId;
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

export function decideSandboxPreviewAnnounce(input: SandboxAnnounceInput): SandboxAnnounceDecision {
  if (isRefusalToolResult(input.toolResult)) return { announce: false, reason: "tool-error" };
  const explicitId = explicitSandboxSessionId(input.toolArgs);
  const explicitSbx = explicitId ? input.getSession(explicitId) : undefined;
  const lookupKey = explicitSbx && explicitId ? explicitId : input.storeKey;
  const sbx = explicitSbx ?? input.getSession(input.storeKey);
  const sandboxId = sbx?.id;
  if (!sandboxId) return { announce: false, reason: "no-session" };
  if (!input.isOwned(lookupKey)) return { announce: false, reason: "not-owned", sandboxId };
  if (input.isSharedOrReadOnly(sandboxId)) return { announce: false, reason: "shared-readonly", sandboxId };
  if (input.announced.has(sandboxId)) return { announce: false, reason: "already-announced", sandboxId };
  return { announce: true, sandboxId };
}
