/**
 * Build the retain-time extraction mission for an agent's memory bank.
 *
 * This text steers the provider's fact extraction (Hindsight
 * `retain_mission`). Experimentally (2026-07-17, 4-way bank comparison):
 * unsteered defaults produced thin generic facts; a domain mission + verbose
 * extraction over a real transcript produced 10x richer atomic facts. The
 * harness-ignore clause exists because transcripts embed agent-harness
 * protocol text (response-channel rules, tool contracts) that extraction
 * otherwise memorizes as if it were domain knowledge.
 */
export function buildRetainMission(agent: { name?: string | null; description?: string | null }): string {
  const who = agent.name?.trim() || "this agent";
  const domain = agent.description?.trim();
  return [
    `This bank stores durable engineering and domain knowledge for ${who}.`,
    domain ? `The agent's domain: ${domain}` : "",
    "Always keep: how subsystems and components work, architecture and data flow, API contracts and endpoint names, exact limits/constants/config values, debugging procedures, error signatures, design decisions and their reasons, gotchas and corrections to earlier understanding.",
    "Ignore: greetings and meeting logistics, plan/todo mechanics, agent-harness operating rules (response-channel or tool-calling protocol, sandbox usage rules), and anything about how the assistant itself should format replies.",
  ]
    .filter(Boolean)
    .join(" ");
}
