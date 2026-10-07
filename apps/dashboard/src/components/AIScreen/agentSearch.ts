import type { AccessibleClawAgent } from '../../services/clawAgentListService';

/**
 * Filter + rank agents for the picker search.
 * Name matches (prefix, then word-start, then substring) come first, then slug
 * matches, then description-only matches. Without ranking, a query like "xyne"
 * lists every agent that merely mentions Xyne in its description ahead of the
 * agents actually named "Xyne …", because the API returns agents alphabetically.
 * Order within a tier is preserved (stable sort); non-matches are dropped.
 */
export function rankAgentsByQuery(
  agents: AccessibleClawAgent[],
  rawQuery: string,
): AccessibleClawAgent[] {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return agents;

  const score = (agent: AccessibleClawAgent): number => {
    const name = agent.name.toLowerCase();
    if (name.startsWith(q)) return 0;
    if (name.split(/[\s\-_]+/).some(word => word.startsWith(q))) return 1;
    if (name.includes(q)) return 2;
    if (agent.slug.toLowerCase().includes(q)) return 3;
    if ((agent.description ?? '').toLowerCase().includes(q)) return 4;
    return -1;
  };

  return agents
    .map((agent, index) => ({ agent, index, rank: score(agent) }))
    .filter(entry => entry.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(entry => entry.agent);
}
