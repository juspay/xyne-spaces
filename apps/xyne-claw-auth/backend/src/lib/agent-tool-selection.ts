/**
 * Categorize a FLAT list of tool tokens (as accepted by the agent-authoring
 * tools create-agent / create-subagent / update-agent / update-subagent) into
 * the `config.tools` buckets the rest of the system reads
 * (readConfigToolSelection in routes/agents.ts).
 *
 * Scope (deliberate): only the two buckets that are unambiguous and safe to set
 * from a flat token are resolved here —
 *   - `subagents` ← exact match on a catalog subagent NAME
 *   - `custom`    ← exact match on a custom tool SLUG (e.g. "web-search")
 * Anything else (MCP server tools, gateway service tools) needs a source-scoped
 * selection key whose bucket depends on integration state; mis-bucketing there
 * would silently mis-wire the agent. Those tokens are returned as `unknown` so
 * the caller can report them back and the author can wire them via the UI. This
 * matches the tools' "unknown entries are skipped and reported" contract.
 */

import type { AvailableToolsCatalog } from "../routes/tools.js";

export interface CategorizedToolSelection {
  /** Selected subagent names (empty unless allowSubagents). */
  subagents: string[];
  /** Selected custom tool slugs. */
  custom: string[];
  /** Tokens that matched no subagent name or custom tool slug. */
  unknown: string[];
}

/**
 * @param tools flat list of tool slugs / subagent names supplied by the author
 * @param catalog org tool catalog from buildAvailableToolsCatalog
 * @param opts.allowSubagents whether subagent selection is valid for this target
 *        (agents: yes; subagents cannot themselves nest subagents → false)
 */
export function categorizeToolSelection(
  tools: string[],
  catalog: AvailableToolsCatalog,
  opts: { allowSubagents: boolean },
): CategorizedToolSelection {
  const subagentNames = new Set(catalog.subagents.map((s) => s.name));
  const customSlugs = new Set(catalog.customGroups.flatMap((g) => g.tools.map((t) => t.slug)));

  const subagents = new Set<string>();
  const custom = new Set<string>();
  const unknown: string[] = [];

  for (const raw of tools) {
    const token = raw.trim();
    if (!token) continue;
    if (opts.allowSubagents && subagentNames.has(token)) {
      subagents.add(token);
    } else if (customSlugs.has(token)) {
      custom.add(token);
    } else {
      unknown.push(token);
    }
  }

  return { subagents: [...subagents], custom: [...custom], unknown };
}

/** Build the `config.tools` object from a categorized selection, omitting empty
 *  buckets so a tool-less agent gets `{}` rather than `{ tools: {...empties} }`. */
export function toConfigTools(sel: CategorizedToolSelection): { subagents?: string[]; custom?: string[] } {
  return {
    ...(sel.subagents.length > 0 ? { subagents: sel.subagents } : {}),
    ...(sel.custom.length > 0 ? { custom: sel.custom } : {}),
  };
}
