/**
 * Agent-creation authoring pack — gap shortlists for MCP / builtin / subagent / skill.
 * Laya re-ranks a lexical shortlist when available; otherwise lexical alone.
 * Closed pick happens by calling claw /suggest-tools with the truncated catalog.
 */
import { createHash } from "node:crypto";
import { createLogger } from "../logger.js";
import {
  layaHealth,
  layaSuggestMode,
  layaSystemOne,
  type LayaSuggestMode,
} from "./laya-client.js";

const log = createLogger("laya-authoring");

export const AUTHORING_PACK_VERSION = "authoring-pack-v1";

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

/** In-memory ring for local audit / later fine-tune export. */
const decisionRing: LayaDecisionAudit[] = [];
const RING_MAX = 500;

export function recentLayaDecisions(limit = 50): LayaDecisionAudit[] {
  return decisionRing.slice(-limit);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

function scoreHay(hay: string, tokens: string[]): number {
  const h = hay.toLowerCase();
  let score = 0;
  for (const t of tokens) {
    if (h.includes(t)) score += Math.min(8, t.length);
  }
  return score;
}

function truncate(s: string, n: number): string {
  const t = (s ?? "").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

const SHORTLIST_CAP = 12;

function lexicalTop<T>(
  items: T[],
  scoreOf: (item: T) => number,
  cap = SHORTLIST_CAP,
): T[] {
  return [...items]
    .map((item) => ({ item, score: scoreOf(item) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, cap)
    .map((row) => row.item);
}

/**
 * When every score is 0, keep a small popularity-agnostic slice so the closed
 * pick still has something to choose from (conservative first N).
 */
function lexicalOrFallback<T>(
  items: T[],
  scoreOf: (item: T) => number,
  cap = SHORTLIST_CAP,
): T[] {
  const hit = lexicalTop(items, scoreOf, cap);
  if (hit.length > 0) return hit;
  return items.slice(0, Math.min(cap, items.length));
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
  for (const c of candidates.slice(0, SHORTLIST_CAP)) {
    criteria[c.id] = truncate(c.blurb, 80);
  }
  // Always include a none option so thin agents stay thin.
  criteria["__none__"] = "none of these; leave this hub empty";
  const answers = await layaSystemOne(intent, {
    [questionKey]: { type: "choice", instructions, criteria },
  });
  if (!answers?.answers?.[questionKey]) return null;
  const choice = answers.answers[questionKey]?.choice;
  const probs = answers.answers[questionKey]?.probabilities ?? {};
  if (!choice || choice === "__none__") return [];
  // Return chosen first, then other high-prob candidates (excluding none).
  const ranked = Object.entries(probs)
    .filter(([k]) => k !== "__none__")
    .sort((a, b) => b[1]! - a[1]!)
    .map(([k]) => k);
  if (!ranked.includes(choice)) ranked.unshift(choice);
  return ranked.slice(0, SHORTLIST_CAP);
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

/**
 * Build a truncated catalog for the closed LLM pick.
 * Hubs that are not "empty" should already be filled by Hub local binds —
 * callers pass which hubs still need suggest.
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
  const tokens = tokenize(args.intent);
  const empty = new Set(args.emptyHubs);
  const shortlistIds: string[] = [];

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

  const layaUp = await layaHealth();
  let fallback: LayaDecisionAudit["fallback"] = layaUp ? "none" : "down";

  const mcpIntegrations = args.catalog.integrations.filter(
    (i) =>
      !i.slug.startsWith("custom:") &&
      i.readTools.length + i.writeTools.length > 0,
  );
  // Treat gateway-looking + mcp-looking as mcp hub; custom:* sources as builtin.
  const builtinIntegrations = args.catalog.integrations.filter((i) =>
    i.slug.startsWith("custom:") || i.slug.startsWith("builtin:"),
  );

  let shortSubagents = args.catalog.subagents;
  let shortIntegrations = args.catalog.integrations;
  let skillSlugs: string[] = [];

  if (empty.has("subagent")) {
    let picked = lexicalOrFallback(
      args.catalog.subagents,
      (s) => scoreHay(`${s.name} ${s.description}`, tokens),
    );
    if (layaUp && picked.length > 1) {
      const ranked = await layaRerankChoice(
        args.intent,
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
        fallback = "down";
      }
    }
    shortSubagents = picked;
    shortlistIds.push(...picked.map((s) => `subagent:${s.name}`));
  }

  if (empty.has("mcp")) {
    let picked = lexicalOrFallback(
      mcpIntegrations,
      (i) =>
        scoreHay(
          `${i.slug} ${i.label} ${i.readTools.map((t) => t.name).join(" ")} ${i.writeTools.map((t) => t.name).join(" ")}`,
          tokens,
        ),
    );
    if (layaUp && picked.length > 1) {
      const ranked = await layaRerankChoice(
        args.intent,
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
        fallback = "down";
      }
    }
    shortlistIds.push(...picked.map((i) => `mcp:${i.slug}`));
    // Keep builtins already in shortIntegrations path separate
    const builtinKeep = empty.has("builtin")
      ? []
      : args.catalog.integrations.filter(
          (i) => i.slug.startsWith("custom:") || i.slug.startsWith("builtin:"),
        );
    shortIntegrations = [...picked, ...builtinKeep];
  }

  if (empty.has("builtin")) {
    let picked = lexicalOrFallback(
      builtinIntegrations.length > 0
        ? builtinIntegrations
        : args.catalog.integrations,
      (i) =>
        scoreHay(
          `${i.slug} ${i.label} ${[...i.readTools, ...i.writeTools].map((t) => `${t.name} ${t.description}`).join(" ")}`,
          tokens,
        ),
    );
    // Prefer custom:/builtin: when present
    if (builtinIntegrations.length > 0) {
      picked = lexicalOrFallback(builtinIntegrations, (i) =>
        scoreHay(
          `${i.slug} ${i.label} ${[...i.readTools, ...i.writeTools].map((t) => t.name).join(" ")}`,
          tokens,
        ),
      );
    }
    if (layaUp && picked.length > 1) {
      const ranked = await layaRerankChoice(
        args.intent,
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
        fallback = "down";
      }
    }
    shortlistIds.push(...picked.map((i) => `builtin:${i.slug}`));
    const mcpKeep = shortIntegrations.filter(
      (i) => !i.slug.startsWith("custom:") && !i.slug.startsWith("builtin:"),
    );
    shortIntegrations = [...mcpKeep, ...picked];
  }

  if (empty.has("skill") && args.skills && args.skills.length > 0) {
    let picked = lexicalOrFallback(args.skills, (s) =>
      scoreHay(`${s.slug} ${s.name} ${s.description}`, tokens),
    );
    if (layaUp && picked.length > 1) {
      const ranked = await layaRerankChoice(
        args.intent,
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
        fallback = "down";
      }
    }
    skillSlugs = picked.slice(0, 1).map((s) => s.slug);
    shortlistIds.push(...picked.map((s) => `skill:${s.slug}`));
  }

  if (shortlistIds.length === 0 && args.emptyHubs.length > 0) {
    fallback = fallback === "down" ? "down" : "empty";
  }

  const truncated: SuggestCatalog = {
    subagents: empty.has("subagent") ? shortSubagents : args.catalog.subagents.slice(0, SHORTLIST_CAP),
    integrations:
      empty.has("mcp") || empty.has("builtin")
        ? shortIntegrations
        : args.catalog.integrations.slice(0, SHORTLIST_CAP),
  };

  // Deduplicate integrations by slug
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
 * Conservative: if catalog is large, treat all hubs as potentially empty.
 */
export function defaultEmptyHubs(catalog: SuggestCatalog, hasSkills: boolean): EmptyHub[] {
  const hubs: EmptyHub[] = [];
  if (catalog.integrations.some((i) => !i.slug.startsWith("custom:"))) hubs.push("mcp");
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
