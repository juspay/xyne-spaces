/**
 * Agent-creation authoring pack — gap shortlists for MCP / builtin / subagent / skill.
 * Stage C: BM25 over enriched docs → top 8 (empty when no score).
 * Optional Laya re-rank when healthy; closed pick via claw /suggest-tools.
 */
import { createHash } from "node:crypto";
import { createLogger } from "../logger.js";
import { bm25Rank } from "./bm25.js";
import {
  enrichIntegrationDoc,
  enrichSkillDoc,
  enrichSubagentDoc,
} from "./selection-docs.js";
import { SHORTLIST_TOP_K } from "./selection-thresholds.js";
import {
  layaHealthCached,
  layaSuggestMode,
  layaSystemOne,
  type LayaSuggestMode,
} from "./laya-client.js";

const log = createLogger("laya-authoring");

export const AUTHORING_PACK_VERSION = "authoring-pack-v2";

export interface SuggestCatalog {
  subagents: Array<{ name: string; description: string }>;
  integrations: Array<{
    slug: string;
    label: string;
    readTools: Array<{ name: string; description: string; riskLevel: string }>;
    writeTools: Array<{ name: string; description: string; riskLevel: string }>;
  }>;
}

export interface SkillCandidate {
  slug: string;
  name: string;
  description: string;
  content?: string;
}

export type EmptyHub = "mcp" | "builtin" | "subagent" | "skill";

export interface LayaDecisionAudit {
  surface: "hub" | "chat";
  emptyHubs: EmptyHub[];
  shortlistIds: string[];
  closedPick: Record<string, unknown> | null;
  latencyMs: number;
  fallback: "none" | "down" | "empty" | "off";
  mode: LayaSuggestMode;
  packVersion: string;
  stateHash: string;
}

const decisionRing: LayaDecisionAudit[] = [];
const RING_MAX = 500;

export function recentLayaDecisions(limit = 50): LayaDecisionAudit[] {
  return decisionRing.slice(-limit);
}

function truncate(s: string, n: number): string {
  const t = (s ?? "").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

/**
 * BM25 top-K. Returns empty when nothing scores — never first-N spray.
 */
function bm25TopById<T>(
  intent: string,
  items: T[],
  idOf: (item: T) => string,
  textOf: (item: T) => string,
  cap = SHORTLIST_TOP_K,
): T[] {
  if (items.length === 0) return [];
  const docs = items.map((item) => ({ id: idOf(item), text: textOf(item) }));
  const hits = bm25Rank(intent, docs, { topK: cap });
  if (hits.length === 0) return [];
  const byId = new Map(items.map((item) => [idOf(item), item]));
  return hits.map((h) => byId.get(h.id)).filter((x): x is T => !!x);
}

async function layaRerankChoice(
  intent: string,
  questionKey: string,
  instructions: string,
  candidates: Array<{ id: string; blurb: string }>,
): Promise<string[] | null> {
  if (candidates.length === 0) return [];
  if (candidates.length === 1) return [candidates[0]!.id];
  const criteria: Record<string, string> = {};
  for (const c of candidates.slice(0, SHORTLIST_TOP_K)) {
    criteria[c.id] = truncate(c.blurb, 80);
  }
  criteria["__none__"] = "none of these; leave this hub empty";
  const answers = await layaSystemOne(intent, {
    [questionKey]: { type: "choice", instructions, criteria },
  });
  if (!answers?.answers?.[questionKey]) return null;
  const choice = answers.answers[questionKey]?.choice;
  const probs = answers.answers[questionKey]?.probabilities ?? {};
  if (!choice || choice === "__none__") return [];
  const ranked = Object.entries(probs)
    .filter(([k]) => k !== "__none__")
    .sort((a, b) => b[1]! - a[1]!)
    .map(([k]) => k);
  if (!ranked.includes(choice)) ranked.unshift(choice);
  return ranked.slice(0, SHORTLIST_TOP_K);
}

export interface GapShortlistResult {
  catalog: SuggestCatalog;
  skillSlugs: string[];
  emptyHubs: EmptyHub[];
  shortlistIds: string[];
  fallback: LayaDecisionAudit["fallback"];
  latencyMs: number;
  layaUp: boolean;
}

type HubWork = {
  hub: EmptyHub;
  shortlistIds: string[];
  subagents?: SuggestCatalog["subagents"];
  integrations?: SuggestCatalog["integrations"];
  skillSlugs?: string[];
  fallbackDown: boolean;
};

async function shortlistSubagent(
  intent: string,
  catalog: SuggestCatalog,
  layaUp: boolean,
): Promise<HubWork> {
  const docs = catalog.subagents.map(enrichSubagentDoc);
  let picked = bm25TopById(
    intent,
    catalog.subagents,
    (s) => s.name,
    (s) => docs.find((d) => d.id === s.name)?.text ?? `${s.name} ${s.description}`,
  );
  let fallbackDown = false;
  if (layaUp && picked.length > 1) {
    const ranked = await layaRerankChoice(
      intent,
      "subagent_shortlist",
      "Which specialist subagent best matches this agent job? Prefer none if unclear.",
      picked.map((s) => ({
        id: s.name,
        blurb: `${s.name}: ${s.description || "subagent"}`,
      })),
    );
    if (ranked) {
      if (ranked.length === 0) picked = [];
      else {
        const byName = new Map(picked.map((s) => [s.name, s]));
        picked = ranked.map((id) => byName.get(id)).filter((s): s is (typeof picked)[0] => !!s);
      }
    } else {
      fallbackDown = true;
    }
  }
  return {
    hub: "subagent",
    shortlistIds: picked.map((s) => `subagent:${s.name}`),
    subagents: picked,
    fallbackDown,
  };
}

async function shortlistMcp(
  intent: string,
  mcpIntegrations: SuggestCatalog["integrations"],
  layaUp: boolean,
): Promise<HubWork> {
  let picked = bm25TopById(
    intent,
    mcpIntegrations,
    (i) => i.slug,
    (i) => enrichIntegrationDoc(i).text,
  );
  let fallbackDown = false;
  if (layaUp && picked.length > 1) {
    const ranked = await layaRerankChoice(
      intent,
      "mcp_shortlist",
      "Which MCP or gateway integration best matches this agent job? Prefer none if unclear.",
      picked.map((i) => ({
        id: i.slug,
        blurb: `${i.label}: ${i.readTools
          .slice(0, 4)
          .map((t) => t.name)
          .join(", ")}`,
      })),
    );
    if (ranked) {
      if (ranked.length === 0) picked = [];
      else {
        const bySlug = new Map(picked.map((i) => [i.slug, i]));
        picked = ranked.map((id) => bySlug.get(id)).filter((i): i is (typeof picked)[0] => !!i);
      }
    } else {
      fallbackDown = true;
    }
  }
  return {
    hub: "mcp",
    shortlistIds: picked.map((i) => `mcp:${i.slug}`),
    integrations: picked,
    fallbackDown,
  };
}

async function shortlistBuiltin(
  intent: string,
  builtinIntegrations: SuggestCatalog["integrations"],
  allIntegrations: SuggestCatalog["integrations"],
  layaUp: boolean,
): Promise<HubWork> {
  const pool = builtinIntegrations.length > 0 ? builtinIntegrations : allIntegrations;
  let picked = bm25TopById(intent, pool, (i) => i.slug, (i) => enrichIntegrationDoc(i).text);
  let fallbackDown = false;
  if (layaUp && picked.length > 1) {
    const ranked = await layaRerankChoice(
      intent,
      "builtin_shortlist",
      "Which built-in or custom tool group best matches this agent job? Prefer none if unclear.",
      picked.map((i) => ({
        id: i.slug,
        blurb: `${i.label}: ${[...i.readTools, ...i.writeTools]
          .slice(0, 6)
          .map((t) => t.name)
          .join(", ")}`,
      })),
    );
    if (ranked) {
      if (ranked.length === 0) picked = [];
      else {
        const bySlug = new Map(picked.map((i) => [i.slug, i]));
        picked = ranked.map((id) => bySlug.get(id)).filter((i): i is (typeof picked)[0] => !!i);
      }
    } else {
      fallbackDown = true;
    }
  }
  return {
    hub: "builtin",
    shortlistIds: picked.map((i) => `builtin:${i.slug}`),
    integrations: picked,
    fallbackDown,
  };
}

async function shortlistSkill(
  intent: string,
  skills: SkillCandidate[],
  layaUp: boolean,
): Promise<HubWork> {
  let picked = bm25TopById(
    intent,
    skills,
    (s) => s.slug,
    (s) => enrichSkillDoc(s).text,
  );
  let fallbackDown = false;
  if (layaUp && picked.length > 1) {
    const ranked = await layaRerankChoice(
      intent,
      "skill_shortlist",
      "Which org skill (procedure) should attach to this agent? Prefer none for a thin agent.",
      picked.map((s) => ({
        id: s.slug,
        blurb: `${s.name}: ${s.description || s.slug}`,
      })),
    );
    if (ranked) {
      if (ranked.length === 0) picked = [];
      else {
        const bySlug = new Map(picked.map((s) => [s.slug, s]));
        picked = ranked.map((id) => bySlug.get(id)).filter((s): s is (typeof picked)[0] => !!s);
      }
    } else {
      fallbackDown = true;
    }
  }
  // Cap shortlist at TOP_K; thresholding happens after judge.
  const skillSlugs = picked.slice(0, SHORTLIST_TOP_K).map((s) => s.slug);
  return {
    hub: "skill",
    shortlistIds: picked.map((s) => `skill:${s.slug}`),
    skillSlugs,
    fallbackDown,
  };
}

/**
 * Build a truncated catalog for the closed LLM pick.
 * Hubs that are not "empty" should already be filled by Hub local binds —
 * callers pass which hubs still need suggest.
 * Per-hub shortlists run in parallel when Laya is up.
 */
export async function buildGapShortlist(args: {
  intent: string;
  catalog: SuggestCatalog;
  skills?: SkillCandidate[];
  emptyHubs: EmptyHub[];
  surface: "hub" | "chat";
}): Promise<GapShortlistResult> {
  const started = Date.now();
  const mode = layaSuggestMode();
  const empty = new Set(args.emptyHubs);

  if (mode === "off" || args.emptyHubs.length === 0) {
    const audit: LayaDecisionAudit = {
      surface: args.surface,
      emptyHubs: args.emptyHubs,
      shortlistIds: [],
      closedPick: null,
      latencyMs: Date.now() - started,
      fallback: mode === "off" ? "off" : "empty",
      mode,
      packVersion: AUTHORING_PACK_VERSION,
      stateHash: createHash("sha256").update(args.intent).digest("hex").slice(0, 16),
    };
    pushAudit(audit);
    return {
      catalog: args.catalog,
      skillSlugs: [],
      emptyHubs: args.emptyHubs,
      shortlistIds: [],
      fallback: audit.fallback,
      latencyMs: audit.latencyMs,
      layaUp: false,
    };
  }

  const layaUp = await layaHealthCached();
  let fallback: LayaDecisionAudit["fallback"] = layaUp ? "none" : "down";

  const mcpIntegrations = args.catalog.integrations.filter(
    (i) =>
      !i.slug.startsWith("custom:") &&
      !i.slug.startsWith("builtin:") &&
      i.readTools.length + i.writeTools.length > 0,
  );
  const builtinIntegrations = args.catalog.integrations.filter(
    (i) => i.slug.startsWith("custom:") || i.slug.startsWith("builtin:"),
  );

  const jobs: Array<Promise<HubWork>> = [];
  if (empty.has("subagent")) jobs.push(shortlistSubagent(args.intent, args.catalog, layaUp));
  if (empty.has("mcp")) jobs.push(shortlistMcp(args.intent, mcpIntegrations, layaUp));
  if (empty.has("builtin")) {
    jobs.push(shortlistBuiltin(args.intent, builtinIntegrations, args.catalog.integrations, layaUp));
  }
  if (empty.has("skill") && args.skills && args.skills.length > 0) {
    jobs.push(shortlistSkill(args.intent, args.skills, layaUp));
  }

  const results = await Promise.all(jobs);

  let shortSubagents = args.catalog.subagents;
  let shortIntegrations: SuggestCatalog["integrations"] = [];
  let skillSlugs: string[] = [];
  const shortlistIds: string[] = [];

  for (const r of results) {
    shortlistIds.push(...r.shortlistIds);
    if (r.fallbackDown) fallback = "down";
    if (r.hub === "subagent" && r.subagents) shortSubagents = r.subagents;
    if (r.hub === "mcp" && r.integrations) {
      shortIntegrations = [...shortIntegrations, ...r.integrations];
    }
    if (r.hub === "builtin" && r.integrations) {
      shortIntegrations = [...shortIntegrations, ...r.integrations];
    }
    if (r.hub === "skill" && r.skillSlugs) skillSlugs = r.skillSlugs;
  }

  // If mcp/builtin not empty, keep those integrations for claw context.
  if (!empty.has("mcp") && !empty.has("builtin")) {
    shortIntegrations = args.catalog.integrations.slice(0, SHORTLIST_TOP_K);
  } else if (!empty.has("mcp")) {
    shortIntegrations = [
      ...args.catalog.integrations.filter(
        (i) => !i.slug.startsWith("custom:") && !i.slug.startsWith("builtin:"),
      ),
      ...shortIntegrations,
    ];
  } else if (!empty.has("builtin")) {
    shortIntegrations = [
      ...shortIntegrations,
      ...args.catalog.integrations.filter(
        (i) => i.slug.startsWith("custom:") || i.slug.startsWith("builtin:"),
      ),
    ];
  }

  if (shortlistIds.length === 0 && args.emptyHubs.length > 0) {
    fallback = fallback === "down" ? "down" : "empty";
  }

  const truncated: SuggestCatalog = {
    subagents: empty.has("subagent")
      ? shortSubagents
      : args.catalog.subagents.slice(0, SHORTLIST_TOP_K),
    integrations:
      empty.has("mcp") || empty.has("builtin")
        ? shortIntegrations
        : args.catalog.integrations.slice(0, SHORTLIST_TOP_K),
  };

  const seen = new Set<string>();
  truncated.integrations = truncated.integrations.filter((i) => {
    if (seen.has(i.slug)) return false;
    seen.add(i.slug);
    return true;
  });

  const latencyMs = Date.now() - started;
  const audit: LayaDecisionAudit = {
    surface: args.surface,
    emptyHubs: args.emptyHubs,
    shortlistIds,
    closedPick: null,
    latencyMs,
    fallback,
    mode,
    packVersion: AUTHORING_PACK_VERSION,
    stateHash: createHash("sha256").update(args.intent).digest("hex").slice(0, 16),
  };
  pushAudit(audit);

  log.info(
    `[laya-decision] surface=${args.surface} emptyHubs=${args.emptyHubs.join(",") || "-"} ` +
      `shortlist=${shortlistIds.slice(0, 20).join("|") || "-"} pick=- latencyMs=${latencyMs} ` +
      `fallback=${fallback} mode=${mode}`,
  );

  return {
    catalog: truncated,
    skillSlugs,
    emptyHubs: args.emptyHubs,
    shortlistIds,
    fallback,
    latencyMs,
    layaUp,
  };
}

export function recordClosedPick(
  prior: GapShortlistResult,
  surface: "hub" | "chat",
  closedPick: Record<string, unknown>,
): void {
  const audit: LayaDecisionAudit = {
    surface,
    emptyHubs: prior.emptyHubs,
    shortlistIds: prior.shortlistIds,
    closedPick,
    latencyMs: prior.latencyMs,
    fallback: prior.fallback,
    mode: layaSuggestMode(),
    packVersion: AUTHORING_PACK_VERSION,
    stateHash: createHash("sha256")
      .update(JSON.stringify(closedPick))
      .digest("hex")
      .slice(0, 16),
  };
  pushAudit(audit);
  const pickSummary = [
    Array.isArray(closedPick["subagents"])
      ? `subagents=${(closedPick["subagents"] as string[]).join(",")}`
      : null,
    Array.isArray(closedPick["integrations"])
      ? `integrations=${(closedPick["integrations"] as Array<{ slug: string }>)
          .map((i) => i.slug)
          .join(",")}`
      : null,
    Array.isArray(closedPick["skillSlugs"])
      ? `skills=${(closedPick["skillSlugs"] as string[]).join(",")}`
      : null,
  ]
    .filter(Boolean)
    .join(" ");
  log.info(
    `[laya-decision] surface=${surface} emptyHubs=${prior.emptyHubs.join(",") || "-"} ` +
      `shortlist=${prior.shortlistIds.slice(0, 20).join("|") || "-"} pick={${pickSummary}} ` +
      `latencyMs=${prior.latencyMs} fallback=${prior.fallback} mode=${layaSuggestMode()}`,
  );
}

function pushAudit(row: LayaDecisionAudit): void {
  decisionRing.push(row);
  while (decisionRing.length > RING_MAX) decisionRing.shift();
}

/**
 * Infer which hubs still need a suggest when the Hub client does not pass them.
 * Prefer clients sending real emptyHubs.
 */
export function defaultEmptyHubs(catalog: SuggestCatalog, hasSkills: boolean): EmptyHub[] {
  const hubs: EmptyHub[] = [];
  if (catalog.integrations.some((i) => !i.slug.startsWith("custom:") && !i.slug.startsWith("builtin:"))) {
    hubs.push("mcp");
  }
  if (
    catalog.integrations.some(
      (i) => i.slug.startsWith("custom:") || i.slug.startsWith("builtin:"),
    )
  ) {
    hubs.push("builtin");
  }
  if (catalog.subagents.length > 0) hubs.push("subagent");
  if (hasSkills) hubs.push("skill");
  return hubs;
}
