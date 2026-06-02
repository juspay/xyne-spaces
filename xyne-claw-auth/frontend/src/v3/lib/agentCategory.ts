/**
 * agentCategory — derive a display category for an agent from its tools,
 * skills, name, and description. Frontend-only (no DB column today).
 *
 * Adding a new category = append one object to AGENT_CATEGORIES. The
 * `AgentCategoryId` type, the listing section order, any future filter
 * chips, and the upgrade path to a DB column all read from the same array.
 *
 * Upgrade path: when `agent.category` lands as a nullable DB column,
 * callers become `agent.category ?? deriveAgentCategory(agent)`. The
 * registry doubles as the API-side whitelist.
 */

import type { Agent, McpServer } from "../../lib/types";

/* ── Registry ──────────────────────────────────────────────────────── */

export interface AgentCategoryDefinition {
  /** Stable id — what would persist to a DB column if added later. */
  readonly id: string;
  /** Display label rendered in section headers. */
  readonly label: string;
  /** Compact label used for per-row chips where horizontal space is tight. */
  readonly shortLabel: string;
  /** One-line hint shown under the section header. */
  readonly description: string;
  /**
   * Tailwind class string for the per-row chip. Each category gets its own
   * subtle palette so chips are scannable by color at a glance.
   */
  readonly chipClass: string;
  /**
   * Regex matched against a haystack of the agent's tool slugs/names,
   * skill names, agent name, and description. `null` means "no auto-match"
   * (used for the `other` fallback bucket).
   */
  readonly match: RegExp | null;
}

export const AGENT_CATEGORIES = [
  {
    id: "tools-communication",
    label: "Communication",
    shortLabel: "Communication",
    description: "Slack, email, calendars, project trackers",
    chipClass:
      "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:border-sky-500/30",
    match:
      /slack|gmail|\bmail\b|outlook|teams|discord|telegram|whatsapp|notion|linear|jira|asana|calendar|zoom|\bmeet\b|hubspot|salesforce|intercom|zendesk/i,
  },
  {
    id: "code",
    label: "Code",
    shortLabel: "Code",
    description: "Repos, IDEs, CI, testing",
    chipClass:
      "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:border-violet-500/30",
    match:
      /github|gitlab|bitbucket|\bgit\b|\bide\b|vscode|cursor|claude-code|codebase|\brepo\b|lint|\btest\b|pytest|jest|deploy|docker|kubernetes/i,
  },
  {
    id: "data",
    label: "Data",
    shortLabel: "Data",
    description: "SQL, warehouses, spreadsheets",
    chipClass:
      "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30",
    match:
      /bigquery|snowflake|postgres|mysql|\bsql\b|redshift|databricks|athena|\bcsv\b|spreadsheet|excel|metabase|looker|tableau|pandas/i,
  },
  {
    id: "research",
    label: "Research",
    shortLabel: "Research",
    description: "Web search, scraping, knowledge bases",
    chipClass:
      "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30",
    match:
      /\bweb\b|browser|\bsearch\b|perplexity|wikipedia|scrape|fetch|arxiv|scholar|news|crawler/i,
  },
  {
    id: "productivity",
    label: "Productivity",
    shortLabel: "Productivity",
    description: "Drive, Docs, file storage, PDFs",
    chipClass:
      "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30",
    match:
      /\bdrive\b|\bdocs\b|sheets|dropbox|\bbox\b|\bpdf\b|files|onedrive|sharepoint|airtable/i,
  },
  {
    id: "other",
    label: "Other",
    shortLabel: "Other",
    description: "Uncategorized",
    chipClass:
      "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-500/10 dark:text-zinc-300 dark:border-zinc-500/30",
    match: null,
  },
] as const satisfies readonly AgentCategoryDefinition[];

export type AgentCategoryId = (typeof AGENT_CATEGORIES)[number]["id"];

/**
 * Lookup helper. Always returns a definition (the `AgentCategoryId` type
 * is derived from the registry, so any valid id is guaranteed present).
 */
export function getCategoryDefinition(
  id: AgentCategoryId,
): AgentCategoryDefinition {
  // Non-null assertion: `id` is constrained to the registry's own ids.
  return AGENT_CATEGORIES.find((c) => c.id === id)!;
}

/* ── Derivation (generic core) ─────────────────────────────────────── */

/**
 * Pick the category whose rules match the haystack most strongly. Ties
 * broken by registry order (earlier wins) — so put narrower/more-specific
 * buckets first in AGENT_CATEGORIES. Empty/whitespace input → "other".
 */
function deriveCategoryFromHaystack(haystack: string): AgentCategoryId {
  if (!haystack.trim()) return "other";

  let best: { id: AgentCategoryId; score: number } | null = null;
  for (const cat of AGENT_CATEGORIES) {
    if (!cat.match) continue;
    const hits =
      haystack.match(new RegExp(cat.match.source, "gi"))?.length ?? 0;
    if (hits === 0) continue;
    if (!best || hits > best.score) {
      best = { id: cat.id, score: hits };
    }
  }
  return best?.id ?? "other";
}

/**
 * Group items by their derived category. Seeded with all registry ids so
 * the returned map iterates in declared order even when buckets are empty.
 */
function groupByCategory<T>(
  items: readonly T[],
  deriver: (item: T) => AgentCategoryId,
): Map<AgentCategoryId, T[]> {
  const out = new Map<AgentCategoryId, T[]>();
  for (const cat of AGENT_CATEGORIES) out.set(cat.id, []);
  for (const item of items) {
    out.get(deriver(item))!.push(item);
  }
  return out;
}

/* ── Agents ────────────────────────────────────────────────────────── */

function buildAgentHaystack(agent: Agent): string {
  const toolBits: string[] = [];
  for (const t of agent.tools ?? []) {
    if (t.tool?.slug) toolBits.push(t.tool.slug);
    if (t.tool?.name) toolBits.push(t.tool.name);
    if (t.tool?.source) toolBits.push(t.tool.source);
  }
  for (const s of agent.skills ?? []) {
    if (s.skill?.slug) toolBits.push(s.skill.slug);
    if (s.skill?.name) toolBits.push(s.skill.name);
  }
  return [agent.name ?? "", agent.description ?? "", ...toolBits].join(" ");
}

export function deriveAgentCategory(agent: Agent): AgentCategoryId {
  return deriveCategoryFromHaystack(buildAgentHaystack(agent));
}

export function groupAgentsByCategory(
  agents: readonly Agent[],
): Map<AgentCategoryId, Agent[]> {
  return groupByCategory(agents, deriveAgentCategory);
}

/* ── MCPs ──────────────────────────────────────────────────────────── */

/**
 * Direct `type → category` map for known MCPs. Use this for editorial
 * control where we have a definitive answer ("slack is Comms, always"),
 * which avoids the brittleness of regex matching descriptions
 * (e.g. avoids Curie landing in Research because its description happens
 * to contain the word "fetch").
 *
 * Add an entry here when a new well-known MCP type ships. Lowercase keys.
 * Unknown types fall through to `deriveCategoryFromHaystack` below.
 */
const MCP_TYPE_TO_CATEGORY: Readonly<Record<string, AgentCategoryId>> = {
  // Tools & Communication — messaging, mail, CRM, trackers, scheduling
  slack: "tools-communication",
  gmail: "tools-communication",
  google: "tools-communication",        // umbrella: Gmail/Calendar/Contacts
  microsoft: "tools-communication",     // umbrella: Outlook/Teams/Calendar
  asana: "tools-communication",
  notion: "tools-communication",
  hubspot: "tools-communication",
  intercom: "tools-communication",
  salesforce: "tools-communication",
  calendly: "tools-communication",

  // Code — repos, CI
  github: "code",
  gitlab: "code",
  bitbucket: "code",

  // Data — analytics, warehouses, observability
  bigquery: "data",
  databricks: "data",
  amplitude: "data",
  mixpanel: "data",
  grafana: "data",
  kibana: "data",

  // Productivity — files, docs, forms, design
  "google-drive": "productivity",
  egnyte: "productivity",
  docusign: "productivity",
  jotform: "productivity",
  figma: "productivity",

  // Other — finance, commerce, meta-tools, internal (no current bucket)
  stripe: "other",
  shopify: "other",
  sequentialthinking: "other",
  "juspay-internal-tools": "other",
  "xyne-spaces": "other",
};

/**
 * MCPs don't have tools/skills — the MCP *is* the tool. So derivation is
 * a two-step lookup:
 *   1. Direct map by `type` for well-known integrations (deterministic).
 *   2. Regex over `name + type + description` as a fallback for unknown
 *      or custom MCPs (best-effort).
 */
function buildMcpHaystack(mcp: McpServer): string {
  return [mcp.name ?? "", mcp.type ?? "", mcp.description ?? ""].join(" ");
}

export function deriveMcpCategory(mcp: McpServer): AgentCategoryId {
  const typeKey = mcp.type?.toLowerCase();
  if (typeKey && MCP_TYPE_TO_CATEGORY[typeKey]) {
    return MCP_TYPE_TO_CATEGORY[typeKey];
  }
  return deriveCategoryFromHaystack(buildMcpHaystack(mcp));
}

export function groupMcpsByCategory(
  mcps: readonly McpServer[],
): Map<AgentCategoryId, McpServer[]> {
  return groupByCategory(mcps, deriveMcpCategory);
}
