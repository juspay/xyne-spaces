/**
 * Which runs belong to the AGENT rather than to a person.
 *
 * The cross-user redaction in agent-chat.ts withholds tool RESULT bodies when
 * an admin inspects a run they do not own, because a tool result carries that
 * user's private Spaces data — their DMs, their private-channel text.
 *
 * That rationale does not apply to an awakened run. Nobody triggered it, it is
 * owned by the agent's own bot identity, and every tool it called ran under the
 * agent's app token against the channels an admin explicitly configured it to
 * watch. There is no human whose privacy the redaction protects — only an admin
 * who cannot see what the agent they configured actually did, which is the one
 * thing they need in order to trust it enough to take it out of shadow mode.
 *
 * Deliberately keyed on triggerSource rather than on "is this a bot user", so a
 * human-triggered run stays redacted even when an agent identity happens to own
 * a row.
 */

/** Trigger sources for runs that no human initiated and no human owns. */
const AGENT_OWNED_TRIGGER_SOURCES: ReadonlySet<string> = new Set(["heartbeat", "reflex"]);

export function isAgentOwnedRun(triggerSource: string | null | undefined): boolean {
  return !!triggerSource && AGENT_OWNED_TRIGGER_SOURCES.has(triggerSource);
}
