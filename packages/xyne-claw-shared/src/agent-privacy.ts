/**
 * Agent invocation access-control ("who can call this agent").
 *
 * Distinct from the EDIT/share ACL (middleware/agent-acl.ts, AgentShare) which
 * governs who can modify an agent. This governs who can INVOKE it, and must be
 * enforced identically across every surface (Spaces mention/DM, automation,
 * dashboard chat, CLI/service-token, Slack) — the check is a pure function of
 * `agent.config` + the caller's userId so all chokepoints share one rule.
 *
 * Model:
 *   - "everyone" (default, absent config) — any user may invoke.
 *   - "whitelist" — ONLY userIds in `whitelist` may invoke. This is the exact
 *     allowed set: the owner and admins are NOT implicitly included (a
 *     deliberate product choice — put yourself in the list to keep access).
 *
 * Stored under `agent.config.privacy` as `{ mode, whitelist }`.
 */

export type AgentPrivacyMode = "everyone" | "whitelist";

export interface AgentPrivacy {
  mode: AgentPrivacyMode;
  /** UserIds allowed to invoke when mode === "whitelist". Ignored otherwise. */
  whitelist: string[];
}

export const DEFAULT_AGENT_PRIVACY: AgentPrivacy = { mode: "everyone", whitelist: [] };

/**
 * Read the privacy block from an agent's config. Tolerant of legacy/absent
 * shapes: anything that isn't an explicit, well-formed "whitelist" resolves to
 * "everyone" so a malformed config never silently locks an agent.
 */
export function parseAgentPrivacy(config: Record<string, unknown> | null | undefined): AgentPrivacy {
  const raw = (config as Record<string, unknown> | null | undefined)?.["privacy"];
  if (!raw || typeof raw !== "object") return { ...DEFAULT_AGENT_PRIVACY };

  const obj = raw as { mode?: unknown; whitelist?: unknown };
  if (obj.mode !== "whitelist") return { ...DEFAULT_AGENT_PRIVACY };

  const whitelist = Array.isArray(obj.whitelist)
    ? obj.whitelist.filter((u): u is string => typeof u === "string" && u.length > 0)
    : [];
  return { mode: "whitelist", whitelist };
}

/**
 * True when `userId` is allowed to invoke the agent. The single authority used
 * at every dispatch chokepoint. A whitelist with no members denies everyone
 * (an agent nobody can call) rather than failing open — the empty list is a
 * meaningful "locked" state, not "unconfigured".
 */
export function isAgentInvocableBy(
  config: Record<string, unknown> | null | undefined,
  userId: string | null | undefined,
): boolean {
  const { mode, whitelist } = parseAgentPrivacy(config);
  if (mode === "everyone") return true;
  return typeof userId === "string" && userId.length > 0 && whitelist.includes(userId);
}

/**
 * Normalize a privacy block submitted from the agent-settings UI into the
 * canonical stored shape (or undefined to clear it → back to "everyone").
 * Dedupes the whitelist and drops non-string ids. "whitelist" with an empty
 * list is preserved intentionally (a deliberately locked agent).
 */
export function normalizeAgentPrivacy(input: unknown): AgentPrivacy | undefined {
  if (!input || typeof input !== "object") return undefined;
  const obj = input as { mode?: unknown; whitelist?: unknown };
  if (obj.mode === "everyone") return { mode: "everyone", whitelist: [] };
  if (obj.mode !== "whitelist") return undefined;
  const whitelist = Array.isArray(obj.whitelist)
    ? Array.from(new Set(obj.whitelist.filter((u): u is string => typeof u === "string" && u.length > 0)))
    : [];
  return { mode: "whitelist", whitelist };
}
