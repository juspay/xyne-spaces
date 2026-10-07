/**
 * Agent-creation selection core: which MCP integrations, builtin tools,
 * subagents, skills and knowledge collections a described agent needs.
 *
 * XOR answers one calibrated yes/no ("does this agent need X?") per candidate,
 * all in a single request. The per-hub thresholds in selection-thresholds.ts
 * then split each hub into bound (auto-added) and suggested (one-click chip).
 * When XOR is unavailable the caller falls back to the LLM judge, and finally
 * to `shortlistSelection` here (BM25 only; never first-N spray).
 */
import { clipForQuestion, type SystemOneQuestion } from "xyne-claw-shared";
import { bm25Rank } from "./bm25.js";
import {
  enrichIntegrationDoc,
  enrichKnowledgeDoc,
  enrichSkillDoc,
  enrichSubagentDoc,
} from "./selection-docs.js";
import {
  BUILTIN_RULE_TABLE,
  applyBuiltinThresholds,
  applyKnowledgeThresholds,
  applyMcpThresholds,
  applySkillThresholds,
  applySubagentThresholds,
  namedItemConfidence,
  selectionThreshold,
  type AppliedHubResult,
  type JudgedPick,
} from "./selection-thresholds.js";
import type { XorAnswers, XorAsk } from "./xor-client.js";

export type Hub = "mcp" | "builtin" | "subagent" | "skill" | "knowledge";
export const ALL_HUBS: readonly Hub[] = ["mcp", "builtin", "subagent", "skill", "knowledge"];
export type EmptyHub = Hub;

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

export interface KnowledgeCandidate {
  id: string;
  name: string;
  description?: string | null;
  channelName?: string;
  projectName?: string;
}

type Integration = SuggestCatalog["integrations"][number];
type Subagent = SuggestCatalog["subagents"][number];

export interface SelectionInput {
  /** Full request text sent to XOR as the state (description, then prompt context). */
  intent: string;
  /** Text scanned for hard-named products: the user's own words, not the generated prompt. */
  namedText: string;
  catalog: SuggestCatalog;
  skills: SkillCandidate[];
  knowledge: KnowledgeCandidate[];
  /** Hubs the caller wants decided. */
  hubs: Hub[];
}

// ── Candidate pools ──────────────────────────────────────────────────────────

/** Per-hub question caps; they sum to Grid's 80-question request limit with 12 write questions. */
const POOL_CAP: Record<Hub, number> = { mcp: 24, builtin: 12, subagent: 10, skill: 14, knowledge: 8 };
const WRITE_QUESTION_CAP = 12;
const READ_TOOLS_CAP = 60;
const WRITE_TOOLS_CAP = 8;

export function isBuiltinSlug(slug: string): boolean {
  return slug.startsWith("custom:") || slug.startsWith("builtin:");
}

function toolCount(i: Integration): number {
  return i.readTools.length + i.writeTools.length;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** True when the request names the item outright (word-boundary, 4+ chars). */
export function isNamedIn(text: string, ...names: Array<string | undefined>): boolean {
  const hay = ` ${norm(text)} `;
  return names.some((n) => {
    const t = norm(n ?? "");
    return t.length >= 4 && hay.includes(` ${t} `);
  });
}

function integrationNames(i: Integration): string[] {
  return [i.label, i.slug.includes(":") ? "" : i.slug];
}

export interface Pools {
  mcp: Integration[];
  builtin: Integration[];
  subagent: Subagent[];
  skill: SkillCandidate[];
  knowledge: KnowledgeCandidate[];
}

function bm25Order<T>(query: string, items: T[], idOf: (t: T) => string, textOf: (t: T) => string): T[] {
  if (items.length === 0) return [];
  const hits = bm25Rank(query, items.map((t) => ({ id: idOf(t), text: textOf(t) })), { topK: items.length });
  const byId = new Map(items.map((t) => [idOf(t), t]));
  return hits.map((h) => byId.get(h.id)).filter((t): t is T => !!t);
}

/**
 * All candidates when the hub fits its question cap; otherwise named items
 * first, then BM25 order (which is empty when nothing overlaps — no spray).
 */
function limitPool<T>(
  query: string,
  items: T[],
  cap: number,
  idOf: (t: T) => string,
  textOf: (t: T) => string,
  isNamed: (t: T) => boolean,
): T[] {
  if (items.length <= cap) return items;
  const named = items.filter(isNamed);
  const namedIds = new Set(named.map(idOf));
  const ranked = bm25Order(query, items, idOf, textOf).filter((t) => !namedIds.has(idOf(t)));
  return [...named, ...ranked].slice(0, cap);
}

export function buildPools(input: SelectionInput): Pools {
  const want = new Set(input.hubs);
  const q = input.intent;
  const named = input.namedText;
  const integrations = input.catalog.integrations.filter((i) => toolCount(i) > 0);
  const integrationText = (i: Integration): string => enrichIntegrationDoc(i).text;
  const integrationNamed = (i: Integration): boolean => isNamedIn(named, ...integrationNames(i));
  return {
    mcp: want.has("mcp")
      ? limitPool(q, integrations.filter((i) => !isBuiltinSlug(i.slug)), POOL_CAP.mcp, (i) => i.slug, integrationText, integrationNamed)
      : [],
    builtin: want.has("builtin")
      ? limitPool(q, integrations.filter((i) => isBuiltinSlug(i.slug)), POOL_CAP.builtin, (i) => i.slug, integrationText, () => false)
      : [],
    subagent: want.has("subagent")
      ? limitPool(
          q,
          input.catalog.subagents,
          POOL_CAP.subagent,
          (s) => s.name,
          (s) => enrichSubagentDoc(s).text,
          (s) => isNamedIn(named, s.name),
        )
      : [],
    skill: want.has("skill")
      ? limitPool(q, input.skills, POOL_CAP.skill, (s) => s.slug, (s) => enrichSkillDoc(s).text, (s) =>
          isNamedIn(named, s.name, s.slug),
        )
      : [],
    knowledge: want.has("knowledge")
      ? limitPool(q, input.knowledge, POOL_CAP.knowledge, (k) => k.id, (k) => enrichKnowledgeDoc(k).text, (k) =>
          isNamedIn(named, k.name),
        )
      : [],
  };
}

/** Hubs that have anything to choose from, in canvas order. */
export function hubsWithCandidates(input: Omit<SelectionInput, "intent" | "namedText" | "hubs">): Hub[] {
  const integrations = input.catalog.integrations.filter((i) => toolCount(i) > 0);
  const out: Hub[] = [];
  if (integrations.some((i) => !isBuiltinSlug(i.slug))) out.push("mcp");
  if (integrations.some((i) => isBuiltinSlug(i.slug))) out.push("builtin");
  if (input.catalog.subagents.length > 0) out.push("subagent");
  if (input.skills.length > 0) out.push("skill");
  if (input.knowledge.length > 0) out.push("knowledge");
  return out;
}

// ── Questions ────────────────────────────────────────────────────────────────

type QuestionKind = "pick" | "write";
interface QuestionMeta {
  hub: Hub;
  id: string;
  kind: QuestionKind;
}

export interface BuiltQuestions {
  questions: Record<string, SystemOneQuestion>;
  meta: Map<string, QuestionMeta>;
}

const ID_PREFIX: Record<Hub, string> = { mcp: "m", builtin: "b", subagent: "a", skill: "s", knowledge: "k" };

function toolBlurb(i: Integration): string {
  return [...i.readTools, ...i.writeTools]
    .slice(0, 6)
    .map((t) => t.name)
    .join(", ");
}

function noul(instructions: string): SystemOneQuestion {
  return { type: "noul", instructions: clipForQuestion(instructions, 480) };
}

/** Ids are synthetic (`m0`, `w3`): catalog slugs contain `:` and `-`, which Grid rejects. */
export function buildQuestions(pools: Pools, input: SelectionInput): BuiltQuestions {
  const questions: Record<string, SystemOneQuestion> = {};
  const meta = new Map<string, QuestionMeta>();
  const add = (qid: string, hub: Hub, id: string, kind: QuestionKind, q: SystemOneQuestion): void => {
    questions[qid] = q;
    meta.set(qid, { hub, id, kind });
  };

  pools.mcp.forEach((i, n) => add(`m${n}`, "mcp", i.slug, "pick", noul(`Does this agent need ${i.label || i.slug}: ${toolBlurb(i)}?`)));
  pools.builtin.forEach((i, n) =>
    add(`b${n}`, "builtin", i.slug, "pick", noul(`Does this agent need the ${i.label || i.slug} tool: ${toolBlurb(i)}?`)),
  );
  pools.subagent.forEach((s, n) =>
    add(`a${n}`, "subagent", s.name, "pick", noul(`Does this agent need to delegate to the ${s.name} subagent: ${s.description || "specialist"}?`)),
  );
  pools.skill.forEach((s, n) =>
    add(`s${n}`, "skill", s.slug, "pick", noul(`Does this agent need the ${s.name} skill: ${s.description || s.slug}?`)),
  );
  pools.knowledge.forEach((k, n) => {
    const where = [k.channelName, k.projectName].filter(Boolean).join(", ");
    add(
      `k${n}`,
      "knowledge",
      k.id,
      "pick",
      noul(`Does this agent need to search the ${k.name} knowledge collection${k.description ? `: ${k.description}` : where ? ` (${where})` : ""}?`),
    );
  });

  // Write access is asked per integration so a read-only agent never gets write tools.
  const writable = [...pools.builtin, ...pools.mcp].filter((i) => i.writeTools.length > 0);
  const relevance = new Map(
    bm25Order(input.intent, writable, (i) => i.slug, (i) => enrichIntegrationDoc(i).text).map((i, rank) => [i.slug, rank]),
  );
  const writeOrder = (i: Integration): number =>
    isNamedIn(input.namedText, ...integrationNames(i)) ? -1 : (relevance.get(i.slug) ?? 999);
  writable
    .sort((a, b) => writeOrder(a) - writeOrder(b))
    .slice(0, WRITE_QUESTION_CAP)
    .forEach((i, n) => {
      const writes = i.writeTools
        .slice(0, 5)
        .map((t) => t.name)
        .join(", ");
      add(`w${n}`, isBuiltinSlug(i.slug) ? "builtin" : "mcp", i.slug, "write", noul(`Will this agent create, send, post or change data in ${i.label || i.slug} (${writes}), not just read?`));
    });

  return { questions, meta };
}

export function questionState(intent: string): string {
  return `Agent job: ${intent}`;
}

// ── Plan ─────────────────────────────────────────────────────────────────────

export interface HubSelection extends AppliedHubResult {
  hub: Hub;
}

export interface SelectionPlan {
  hubs: Record<Hub, HubSelection>;
  /** Highest candidate probability per hub (0 when the hub had no candidates). */
  needs: Record<Hub, number>;
  /** Probability the agent writes to an external system; 0 when nothing bound can write. */
  writes: number;
  /** Per-integration write probability, for the write-tool grant. */
  writeBySlug: Record<string, number>;
  /** Every scored candidate, kept for persistence and offline tuning. */
  scored: Array<{ hub: Hub; id: string; p: number }>;
}

const emptyHub = (hub: Hub): HubSelection => ({ hub, bound: [], suggested: [], none: true });

function noulOf(answers: XorAnswers, qid: string): number | undefined {
  const v = answers[qid]?.noul;
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function builtinRuleMatches(text: string, builtin: Integration[]): Set<string> {
  const out = new Set<string>();
  for (const rule of BUILTIN_RULE_TABLE) {
    if (!rule.re.test(text)) continue;
    for (const i of builtin) {
      const hay = `${i.slug} ${i.label} ${toolBlurb(i)}`.toLowerCase();
      if (rule.needles.some((needle) => hay.includes(needle))) out.add(i.slug);
    }
  }
  return out;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Pure: turn XOR answers into a bound/suggested plan. Exported for the eval and tests. */
export function planFromAnswers(input: SelectionInput, pools: Pools, built: BuiltQuestions, answers: XorAnswers): SelectionPlan {
  const scored: SelectionPlan["scored"] = [];
  const writeBySlug: Record<string, number> = {};
  const picks: Record<Hub, JudgedPick[]> = { mcp: [], builtin: [], subagent: [], skill: [], knowledge: [] };
  const pScore = new Map<string, number>();

  for (const [qid, m] of built.meta) {
    const p = noulOf(answers, qid);
    if (p === undefined) continue;
    if (m.kind === "write") {
      writeBySlug[m.id] = p;
      continue;
    }
    pScore.set(`${m.hub}:${m.id}`, p);
    scored.push({ hub: m.hub, id: m.id, p: round2(p) });
  }

  const pick = (hub: Hub, id: string, named: boolean): void => {
    const p = pScore.get(`${hub}:${id}`);
    if (named) {
      picks[hub].push({ id, confidence: namedItemConfidence(), reason: "Named in the request" });
    } else if (p !== undefined) {
      picks[hub].push({ id, confidence: round2(p), reason: `XOR ${p.toFixed(2)}` });
    }
  };
  const named = input.namedText;
  pools.mcp.forEach((i) => pick("mcp", i.slug, isNamedIn(named, ...integrationNames(i))));
  pools.builtin.forEach((i) => pick("builtin", i.slug, false));
  pools.subagent.forEach((s) => pick("subagent", s.name, isNamedIn(named, s.name)));
  pools.skill.forEach((s) => pick("skill", s.slug, isNamedIn(named, s.name, s.slug)));
  pools.knowledge.forEach((k) => pick("knowledge", k.id, isNamedIn(named, k.name)));

  const namedSubagents = new Set(pools.subagent.filter((s) => isNamedIn(named, s.name)).map((s) => s.name));
  const hubs: Record<Hub, HubSelection> = {
    mcp: { hub: "mcp", ...applyMcpThresholds(picks.mcp) },
    builtin: { hub: "builtin", ...applyBuiltinThresholds(picks.builtin, builtinRuleMatches(named || input.intent, pools.builtin)) },
    subagent: { hub: "subagent", ...applySubagentThresholds(picks.subagent, namedSubagents) },
    skill: { hub: "skill", ...applySkillThresholds(picks.skill) },
    knowledge: { hub: "knowledge", ...applyKnowledgeThresholds(picks.knowledge) },
  };
  for (const hub of ALL_HUBS) if (!input.hubs.includes(hub)) hubs[hub] = emptyHub(hub);

  return finishPlan(hubs, picks, writeBySlug, scored);
}

function finishPlan(
  hubs: Record<Hub, HubSelection>,
  picks: Record<Hub, JudgedPick[]>,
  writeBySlug: Record<string, number>,
  scored: SelectionPlan["scored"],
): SelectionPlan {
  const needs = {} as Record<Hub, number>;
  for (const hub of ALL_HUBS) needs[hub] = round2(picks[hub].reduce((m, p) => Math.max(m, p.confidence), 0));
  const boundSlugs = [...hubs.mcp.bound, ...hubs.builtin.bound].map((p) => p.id);
  const writes = round2(boundSlugs.reduce((m, slug) => Math.max(m, writeBySlug[slug] ?? 0), 0));
  return { hubs, needs, writes, writeBySlug, scored };
}

/** Ask XOR once for every requested hub. Null when XOR is unavailable. */
export async function planHubSelection(input: SelectionInput, ask: XorAsk): Promise<SelectionPlan | null> {
  const pools = buildPools(input);
  const built = buildQuestions(pools, input);
  if (Object.keys(built.questions).length === 0) {
    const hubs = {} as Record<Hub, HubSelection>;
    const picks = {} as Record<Hub, JudgedPick[]>;
    for (const hub of ALL_HUBS) {
      hubs[hub] = emptyHub(hub);
      picks[hub] = [];
    }
    return finishPlan(hubs, picks, {}, []);
  }
  const answers = await ask(questionState(input.intent), built.questions, { purpose: "suggest-tools" });
  if (!answers) return null;
  return planFromAnswers(input, pools, built, answers);
}

// ── BM25-only fallback (no XOR, no LLM) ──────────────────────────────────────

/** Intent clearly wants a thin / chat-only agent. */
export function intentPrefersNoTools(intent: string): boolean {
  const t = intent.toLowerCase();
  if (/\b(slack|github|jira|gmail|notion|linear|discord|mcp|web[- ]?search|spaces)\b/.test(t)) {
    return false;
  }
  return /\b(chat only|no tools|no integrations|no skills|writing coach|brainstorm|roleplay|interview prep)\b/.test(
    t,
  );
}

const WRITE_VERBS = /\b(create|update|edit|send|post|schedule|upload|write|triage|reply|comment|draft)\b/i;
const SHORTLIST_CAP: Record<Hub, number> = { mcp: 3, builtin: 2, subagent: 2, skill: 3, knowledge: 2 };

/**
 * Lexical fallback: named items bind, other BM25 hits become weak suggestions.
 * Nothing scores → nothing is returned (never first-N spray).
 */
export function shortlistSelection(input: SelectionInput): SelectionPlan {
  const picks: Record<Hub, JudgedPick[]> = { mcp: [], builtin: [], subagent: [], skill: [], knowledge: [] };
  const hubs = {} as Record<Hub, HubSelection>;
  for (const hub of ALL_HUBS) hubs[hub] = emptyHub(hub);

  if (!intentPrefersNoTools(input.namedText || input.intent)) {
    const integrations = input.catalog.integrations.filter((i) => toolCount(i) > 0);
    const weak = (rank: number): number => Math.max(selectionThreshold("suggestMin"), 0.65 - 0.03 * rank);
    const fill = <T>(hub: Hub, items: T[], idOf: (t: T) => string, textOf: (t: T) => string, named: (t: T) => boolean): void => {
      if (!input.hubs.includes(hub)) return;
      const namedItems = items.filter(named);
      const namedIds = new Set(namedItems.map(idOf));
      const ranked = bm25Order(input.intent, items, idOf, textOf).filter((t) => !namedIds.has(idOf(t)));
      picks[hub] = [
        ...namedItems.map((t) => ({ id: idOf(t), confidence: namedItemConfidence(), reason: "Named in the request" })),
        ...ranked.map((t, rank) => ({ id: idOf(t), confidence: round2(weak(rank)), reason: "Keyword match" })),
      ].slice(0, SHORTLIST_CAP[hub]);
    };
    const integrationText = (i: Integration): string => enrichIntegrationDoc(i).text;
    fill("mcp", integrations.filter((i) => !isBuiltinSlug(i.slug)), (i) => i.slug, integrationText, (i) => isNamedIn(input.namedText, ...integrationNames(i)));
    fill("builtin", integrations.filter((i) => isBuiltinSlug(i.slug)), (i) => i.slug, integrationText, () => false);
    fill("subagent", input.catalog.subagents, (s) => s.name, (s) => enrichSubagentDoc(s).text, (s) => isNamedIn(input.namedText, s.name));
    fill("skill", input.skills, (s) => s.slug, (s) => enrichSkillDoc(s).text, (s) => isNamedIn(input.namedText, s.name, s.slug));
    fill("knowledge", input.knowledge, (k) => k.id, (k) => enrichKnowledgeDoc(k).text, (k) => isNamedIn(input.namedText, k.name));

    const namedSubagents = new Set(picks.subagent.filter((p) => p.confidence >= 1).map((p) => p.id));
    const builtin = integrations.filter((i) => isBuiltinSlug(i.slug));
    hubs.mcp = { hub: "mcp", ...applyMcpThresholds(picks.mcp) };
    hubs.builtin = { hub: "builtin", ...applyBuiltinThresholds(picks.builtin, builtinRuleMatches(input.namedText || input.intent, builtin)) };
    hubs.subagent = { hub: "subagent", ...applySubagentThresholds(picks.subagent, namedSubagents) };
    hubs.skill = { hub: "skill", ...applySkillThresholds(picks.skill) };
    hubs.knowledge = { hub: "knowledge", ...applyKnowledgeThresholds(picks.knowledge) };
  }

  // No probability is available here: a write verb in the request is the only signal.
  const wantsWrites = WRITE_VERBS.test(input.namedText || input.intent);
  const writeBySlug: Record<string, number> = {};
  if (wantsWrites) {
    for (const p of [...hubs.mcp.bound, ...hubs.mcp.suggested, ...hubs.builtin.bound, ...hubs.builtin.suggested]) {
      writeBySlug[p.id] = 0.6;
    }
  }
  return finishPlan(hubs, picks, writeBySlug, []);
}

// ── Response ─────────────────────────────────────────────────────────────────

export type SuggestSource = "xor" | "judge" | "shortlist";

export interface SuggestedIntegration {
  slug: string;
  label: string;
  confidence: number;
  readTools: string[];
  writeTools: string[];
}

export interface SuggestToolsData {
  hubs: Record<Hub, { picks: JudgedPick[]; none: boolean; reason?: string }>;
  /** BOUND subagent names. */
  subagents: string[];
  /** BOUND mcp + builtin integrations with tool NAMES (the dashboard binds MCP by tool name). */
  integrations: Array<{ slug: string; readTools: string[]; writeTools: string[] }>;
  /** BOUND skill slugs. */
  skillSlugs: string[];
  /** BOUND knowledge collection ids. */
  knowledgeIds: string[];
  suggested: {
    integrations: SuggestedIntegration[];
    subagents: Array<{ name: string; confidence: number }>;
    skills: Array<{ slug: string; confidence: number }>;
    knowledge: Array<{ id: string; name: string; confidence: number }>;
  };
  needs: Record<Hub, number>;
  writes: number;
  source: SuggestSource;
  latencyMs: number;
  reasoning: Record<string, string>;
}

/** Top write tools of a bound integration: BM25 against the request, padded to 3 so a real write intent is never empty. */
function pickWriteTools(intent: string, i: Integration): string[] {
  if (i.writeTools.length === 0) return [];
  const ranked = bm25Order(intent, i.writeTools, (t) => t.name, (t) => `${t.name} ${t.description}`).map((t) => t.name);
  const padded = [...ranked];
  for (const t of i.writeTools) {
    if (padded.length >= 3) break;
    if (!padded.includes(t.name)) padded.push(t.name);
  }
  return padded.slice(0, WRITE_TOOLS_CAP);
}

export function toSuggestResponse(
  plan: SelectionPlan,
  input: SelectionInput,
  meta: { source: SuggestSource; latencyMs: number },
): SuggestToolsData {
  const bySlug = new Map(input.catalog.integrations.map((i) => [i.slug, i]));
  const tools = (slug: string): { readTools: string[]; writeTools: string[] } => {
    const i = bySlug.get(slug);
    if (!i) return { readTools: [], writeTools: [] };
    const allowWrites = (plan.writeBySlug[slug] ?? 0) >= 0.5;
    return {
      readTools: i.readTools.map((t) => t.name).slice(0, READ_TOOLS_CAP),
      writeTools: allowWrites ? pickWriteTools(input.intent, i) : [],
    };
  };
  const nameOf = (hub: Hub, id: string): string => {
    if (hub === "knowledge") return input.knowledge.find((k) => k.id === id)?.name ?? id;
    return bySlug.get(id)?.label ?? id;
  };

  const hubs = {} as SuggestToolsData["hubs"];
  const reasoning: Record<string, string> = {};
  for (const hub of ALL_HUBS) {
    const sel = plan.hubs[hub];
    hubs[hub] = {
      picks: [...sel.bound, ...sel.suggested],
      none: sel.none,
      ...(sel.reason ? { reason: sel.reason } : {}),
    };
    reasoning[hub] = sel.none
      ? (sel.reason ?? "Nothing needed")
      : [...sel.bound.map((p) => `${nameOf(hub, p.id)} ${p.confidence.toFixed(2)}`), ...sel.suggested.map((p) => `${nameOf(hub, p.id)} ${p.confidence.toFixed(2)} (suggested)`)].join(", ");
  }

  const integrationRow = (p: JudgedPick): { slug: string; readTools: string[]; writeTools: string[] } => ({ slug: p.id, ...tools(p.id) });
  return {
    hubs,
    subagents: plan.hubs.subagent.bound.map((p) => p.id),
    integrations: [...plan.hubs.mcp.bound, ...plan.hubs.builtin.bound].map(integrationRow),
    skillSlugs: plan.hubs.skill.bound.map((p) => p.id),
    knowledgeIds: plan.hubs.knowledge.bound.map((p) => p.id),
    suggested: {
      integrations: [...plan.hubs.mcp.suggested, ...plan.hubs.builtin.suggested].map((p) => ({
        ...integrationRow(p),
        label: nameOf("mcp", p.id),
        confidence: p.confidence,
      })),
      subagents: plan.hubs.subagent.suggested.map((p) => ({ name: p.id, confidence: p.confidence })),
      skills: plan.hubs.skill.suggested.map((p) => ({ slug: p.id, confidence: p.confidence })),
      knowledge: plan.hubs.knowledge.suggested.map((p) => ({ id: p.id, name: nameOf("knowledge", p.id), confidence: p.confidence })),
    },
    needs: plan.needs,
    writes: plan.writes,
    source: meta.source,
    latencyMs: meta.latencyMs,
    reasoning,
  };
}
