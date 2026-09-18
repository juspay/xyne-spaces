import type { RecalledMemory, TagGroup } from "xyne-claw-shared";
import { ensureAgentIndexBank, memory } from "./bank.js";
import { capabilityTag, readAgentTag, readCapabilityTags, readKindTag } from "./render.js";
import { listBankEntries } from "./sync.js";
import { INDEX_KINDS, type AgentMatch, type IndexKind, type StoredBlob } from "./types.js";

export interface FindAgentsOpts {
  /** Restrict which document kinds may match. Defaults to all. */
  kinds?: IndexKind[];
  /** Tool names an agent must hold, all of them. An exact filter, applied by the
   *  provider — semantics decide the ranking, never whether a hard requirement
   *  can be skipped. */
  requiresCapability?: string[];
  limit?: number;
}

const DEFAULT_LIMIT = 10;
const EXCERPT_CHARS = 300;

/**
 * How much text recall may return, which is what actually decides how many
 * agents get considered at all.
 *
 * `budget` does not do this — low, mid and high all returned the same 6 chunks
 * from a 39-chunk bank, so two thirds of the roster was never a candidate and
 * agents appeared to rank badly when they had simply not been retrieved. Only
 * `maxTokens` widens the pool.
 *
 * This bounds candidates, not results: matches are re-read from the bank during
 * enrichment, so the excerpt a chunk carries here is never the final answer.
 * Raise it if a large roster starts losing plausible candidates.
 */
const RECALL_MAX_TOKENS = (() => {
  const n = Number(process.env["AGENT_INDEX_RECALL_MAX_TOKENS"]);
  return Number.isFinite(n) && n > 0 ? n : 32_000;
})();

/**
 * Rank on Hindsight's fused `final` score — its own answer, not a second opinion.
 *
 * An earlier version ranked on the raw `semantic` arm, on the reasoning that the
 * cross-encoder buries descriptive text: a correct match scored 0.74 semantic
 * against 2.8e-05 final. That read the magnitude as a verdict, but the reranker's
 * absolute scores are uncalibrated across queries by design, so a small number
 * says nothing about rank. Measured head to head over 8 routing queries, the two
 * orderings tie — 7/8 top-1 and MRR 0.938 each, trading which query they win.
 *
 * `final` is preferred at the tie because it is the score Hindsight actually
 * ranks by, and because it separates sharply (top match 1.079 against 0.0085)
 * where `semantic` is flat (0.72 / 0.70 / 0.69), leaving room for a confidence
 * cutoff later. Never threshold on it in absolute terms — only sort.
 */
function rankScore(m: RecalledMemory): number {
  return m.scores?.final ?? m.score ?? 0;
}

function filterGroup(kinds: IndexKind[], capabilities: string[]): TagGroup {
  const kindGroup: TagGroup = { tags: kinds.map((k) => `kind:${k}`), match: "any" };
  if (capabilities.length === 0) return kindGroup;
  return { and: [kindGroup, { tags: capabilities.map(capabilityTag), match: "all" }] };
}

/**
 * Search stage: a need in natural language becomes a ranked shortlist of agents.
 *
 * Recall returns chunks; callers rank agents. An agent is scored by its single
 * best chunk, never by the sum — summing would reward a long system prompt for
 * producing more chunks rather than for being a better match.
 *
 * Matches are then enriched from the bank so a caller sees what the agent is and
 * how it is actually used, not only the passage that happened to match. A
 * shortlist is only useful if the reader can judge the fit themselves.
 */
export async function findAgents(orgId: string, need: string, opts: FindAgentsOpts = {}): Promise<AgentMatch[]> {
  const bankId = await ensureAgentIndexBank(orgId);
  const kinds = opts.kinds?.length ? opts.kinds : [...INDEX_KINDS];
  const capabilities = opts.requiresCapability ?? [];

  const results = await memory().recall(bankId, need, {
    budget: "high",
    maxTokens: RECALL_MAX_TOKENS,
    tagGroups: filterGroup(kinds, capabilities),
  });

  const ranked = rankByAgent(results).slice(0, opts.limit ?? DEFAULT_LIMIT);
  return ranked.length > 0 ? enrich(orgId, ranked) : ranked;
}

/**
 * Which kind's text is shown when several matched, most telling first.
 *
 * What people have actually brought an agent beats what its instructions claim,
 * which in turn beats the generated summary of its wiring. Ranking is unaffected
 * — that is still the best score across every chunk — this decides only which
 * passage is quoted back, so the same agent always explains itself the same way
 * instead of quoting whichever chunk happened to score highest.
 */
const KIND_PRIORITY: readonly IndexKind[] = ["usage", "persona", "identity"];

function byPriority(a: IndexKind, b: IndexKind): number {
  return KIND_PRIORITY.indexOf(a) - KIND_PRIORITY.indexOf(b);
}

interface Accumulator {
  slug: string;
  agentId: string | null;
  score: number;
  /** Best-scoring chunk per kind, so the excerpt can follow priority while the
   *  score still follows the strongest match anywhere. */
  best: Map<IndexKind, { score: number; text: string }>;
}

/** Groups chunk hits into per-agent matches, best chunk wins the score. */
export function rankByAgent(results: RecalledMemory[]): AgentMatch[] {
  const byAgent = new Map<string, Accumulator>();

  for (const hit of results) {
    const slug = readAgentTag(hit.tags);
    if (!slug) continue;

    const kind = (readKindTag(hit.tags) as IndexKind) ?? "identity";
    const score = rankScore(hit);
    const text = hit.text.slice(0, EXCERPT_CHARS);

    const current = byAgent.get(slug) ?? {
      slug,
      agentId: hit.metadata?.["agentId"] ?? null,
      score,
      best: new Map<IndexKind, { score: number; text: string }>(),
    };
    current.score = Math.max(current.score, score);
    current.agentId ??= hit.metadata?.["agentId"] ?? null;

    const bestForKind = current.best.get(kind);
    if (!bestForKind || score > bestForKind.score) current.best.set(kind, { score, text });
    byAgent.set(slug, current);
  }

  return [...byAgent.values()]
    .map((acc) => {
      const matchedKinds = [...acc.best.keys()].sort(byPriority);
      const leading = matchedKinds[0];
      return {
        slug: acc.slug,
        agentId: acc.agentId,
        score: acc.score,
        matchedKinds,
        evidence: leading ? (acc.best.get(leading)?.text ?? "") : "",
      };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Attaches each agent's identity and usage documents to its match.
 *
 * Recall answers with whichever chunk scored best, which for a long prompt is
 * often a passage from the middle of it — true, but a poor basis for choosing.
 * The identity says what the agent is for and the usage document says what
 * people actually bring it, and both are already in the bank, so this costs one
 * list call for the whole shortlist.
 */
async function enrich(orgId: string, matches: AgentMatch[]): Promise<AgentMatch[]> {
  const wanted = new Set(matches.map((m) => m.slug));
  const byAgent = new Map<string, StoredBlob[]>();

  for (const blob of await listBankEntries(orgId)) {
    if (!wanted.has(blob.slug)) continue;
    const group = byAgent.get(blob.slug) ?? [];
    group.push(blob);
    byAgent.set(blob.slug, group);
  }

  return matches.map((match) => {
    const blobs = byAgent.get(match.slug) ?? [];
    const identity = blobs.find((b) => b.kind === "identity");
    const usage = blobs
      .filter((b) => b.kind === "usage")
      .sort((a, b) => (a.chunkId ?? "").localeCompare(b.chunkId ?? ""))
      .map((b) => b.text)
      .join("");

    return {
      ...match,
      ...(identity ? { identity: identity.text } : {}),
      ...(usage ? { usage } : {}),
      capabilities: identity ? readCapabilityTags(identity.tags) : [],
    };
  });
}
