/**
 * Agent selection for a channel message. Every account has a DEFAULT agent;
 * a message may start with `/slug ` or `@slug ` to pick another agent of the
 * same org (subject to that agent's invocation ACL). `/agents` lists what the
 * sender can use. Parsing is pure; lookups live in inbound.ts.
 */
import { AGENT_ROUTE_RE, AGENTS_COMMAND_RE } from "./const.js";

export interface AgentRoute {
  /** Explicit agent slug from the prefix, if any. */
  slug?: string;
  /** The message with the routing prefix removed. */
  task: string;
  /** The message was the `/agents` listing command. */
  listAgents: boolean;
}

/**
 * Did this message address the agent by name? A messenger only offers a native
 * @mention inside a group, so in a one-to-one chat the equivalent is opening
 * with "/slug" or "@slug" — which is what parseAgentRoute already reads.
 */
export function namesAnAgent(text: string): boolean {
  const trimmed = text.trim();
  return AGENTS_COMMAND_RE.test(trimmed) || AGENT_ROUTE_RE.test(trimmed);
}

export function parseAgentRoute(text: string): AgentRoute {
  const trimmed = text.trim();
  if (AGENTS_COMMAND_RE.test(trimmed)) return { task: "", listAgents: true };
  const match = AGENT_ROUTE_RE.exec(trimmed);
  if (!match || !match[1]) return { task: trimmed, listAgents: false };
  return { slug: match[1].toLowerCase(), task: trimmed.slice(match[0].length).trim(), listAgents: false };
}

export function formatAgentList(agents: Array<{ slug: string; name: string; isDefault: boolean }>): string {
  if (agents.length === 0) return "No agents are available to you on this number.";
  const lines = agents.map((agent) => `• /${agent.slug} — ${agent.name}${agent.isDefault ? " (default)" : ""}`);
  return [
    "Agents you can message here:",
    ...lines,
    "",
    "Start a message with /slug to pick one; plain messages go to the default.",
  ].join("\n");
}
