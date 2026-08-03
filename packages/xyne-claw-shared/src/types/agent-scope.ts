/**
 * Application-level enum for Agent.scope. The DB column is a free-form String
 * (no Prisma enum, no CHECK constraint) for migration flexibility; this union
 * type + constant set is the single source of truth for valid scope values
 * on the application side.
 *
 *   - "personal"  — owner + shares only
 *   - "global"    — everyone in the org
 *   - "platform"  — everyone in every org; read-only (duplicate to edit)
 */
export const AGENT_SCOPES = ["personal", "global", "platform"] as const;
export type AgentScope = (typeof AGENT_SCOPES)[number];

/** Type guard: is `value` a valid AgentScope? */
export function isAgentScope(value: string): value is AgentScope {
  return (AGENT_SCOPES as readonly string[]).includes(value);
}
