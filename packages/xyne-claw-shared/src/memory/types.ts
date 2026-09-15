/**
 * Memory provider interface — the boundary between xyne's HITL/governance
 * layer and the underlying memory backend.
 *
 * Providers handle: storage, embedding, extraction, recall scoring, graph,
 * mental-model synthesis (where supported).
 *
 * The xyne system handles: human-in-the-loop approval, per-agent policy,
 * audit, recall-hit tracking, UI. Providers are intentionally unaware of
 * approval state — pending memories are simply not retained until approved.
 *
 * Default provider is "hindsight" (vectorize-io/hindsight). Drop-in
 * alternatives can implement this interface and register via the registry.
 */

export interface ProviderCapabilities {
  /** Provider can synthesise higher-order memories from raw ones (e.g., Hindsight Reflect → Mental Models). */
  reflect: boolean;
  /** Provider extracts entities and tracks relationships. */
  entityGraph: boolean;
  /** Provider supports time-based queries ("what happened last quarter?"). */
  temporal: boolean;
  /** Provider supports cross-language recall. */
  multilingual: boolean;
  /** Provider supports compound tag boolean expressions (AND / OR / NOT). */
  tagGroups: boolean;
  /** Provider has BM25-class sparse retrieval (not just dense vectors). */
  sparseRetrieval: boolean;
}

export interface RetainItem {
  content: string;
  tags?: string[];
  metadata?: Record<string, string>;
  /** When the fact actually OCCURRED (ISO). Providers that model time (Hindsight)
   *  use this for recency ranking + temporal queries. Falls back to now() when
   *  omitted — so "worked on A in Jan" and "on B in June" are distinguishable
   *  instead of both looking like they happened at retain time. */
  timestamp?: string;
  /** How to scope observation consolidation (Hindsight). A list of tag-lists
   *  runs one pass per inner list — e.g. `[["user:abc"]]` confines observations
   *  to that user's own facts, which is REQUIRED on a shared multi-user bank so
   *  observations never mix users. Ignored by providers without observations. */
  observationScopes?: string[][];
  /** Named retain strategy (Hindsight) applied to THIS item only — a bundle of
   *  config overrides registered on the bank via EnsureBankOpts.retainStrategies.
   *  Used to retain already-extracted facts verbatim (no LLM re-extraction).
   *  Ignored by providers without named strategies. */
  strategy?: string;
  /** Entities to attach to this memory. In Hindsight's `chunks` extraction mode
   *  (no LLM) these are the ONLY source of entity data, so supplying them is
   *  what lets a verbatim restore rebuild entity links instead of landing as
   *  unconnected nodes. */
  entities?: Array<{ text: string; type?: string }>;
}

export interface RetainedMemory {
  id: string;
  content: string;
  tags: string[];
}

/** Boolean tag expression supported by capable providers; ignored by others. */
export type TagGroup =
  | { tags: string[]; match?: "any" | "all" | "any_strict" | "all_strict" }
  | { and: TagGroup[] }
  | { or: TagGroup[] }
  | { not: TagGroup };

export interface RecallOpts {
  /** Provider-recommended size of result budget. */
  budget?: "low" | "mid" | "high";
  /** Simple tag filter (OR by default). */
  tags?: string[];
  /** Compound tag filter — only honoured by providers with `capabilities.tagGroups`. */
  tagGroups?: TagGroup;
  /** Memory type filter (provider-defined, e.g., "world" | "experience" | "mental_model"). */
  types?: string[];
  /** Soft upper bound on returned tokens; providers may approximate. */
  maxTokens?: number;
  /** Prefer higher-level "observation" memories (evolution-aware syntheses) over
   *  raw facts when available. Hindsight-only; ignored elsewhere. */
  preferObservations?: boolean;
  /** ISO "now" anchor for relative time expressions in the query ("last month",
   *  "before X"). Hindsight parses time windows from the query TEXT; this sets
   *  the reference point. Ignored by providers without temporal search. */
  queryTimestamp?: string;
}

export interface RecalledMemory {
  id: string;
  text: string;
  factType?: string;
  tags?: string[];
  score?: number;
}

export interface ListFilter {
  tags?: string[];
  tagGroups?: TagGroup;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface PaginatedMemories {
  memories: Memory[];
  total?: number;
}

export interface Memory {
  id: string;
  content: string;
  tags?: string[];
  metadata?: Record<string, string>;
  factType?: string;
  createdAt?: string;
  /** Canonical entity names Hindsight extracted for this memory. Drives the
   *  entity edges in the constellation — over half the graph's edges — so an
   *  export that omits them restores memories that look isolated. */
  entities?: string[];
  /** Number of source facts behind this memory. Observations start at 1 and are
   *  incremented by the consolidation pass that also records a history entry, so
   *  `proofCount > 1` is a free "this memory has history" signal — the provider
   *  exposes no dedicated flag, and probing history per memory costs a request
   *  each. Treat it as a hint: history can be cascade-deleted independently. */
  proofCount?: number;
}

/**
 * One prior version of a memory. Hindsight records these ONLY for derived
 * observations (`fact_type === "observation"`), and only when consolidation
 * UPDATES one — creation writes no entry. Raw world/experience facts always
 * return an empty list, so callers should not offer a history affordance for
 * them. Capped at 50 entries by the provider, newest first.
 */
export interface MemoryHistoryEntry {
  /** The memory's text BEFORE this change. */
  previousText: string;
  previousTags?: string[];
  previousMentionedAt?: string;
  /** When the change happened. */
  changedAt: string;
  /** Source facts behind the change, already resolved to their text. */
  sourceFacts?: Array<{ id: string; text: string }>;
}

export interface ReflectResult {
  text: string;
  citations?: Array<{ memoryId: string; text: string }>;
}

/**
 * Entity-relationship graph for a bank. Hindsight returns nodes (canonical
 * entities like "spaces-create-ticket") and edges (cooccurrence / typed
 * relations). Shape mirrors Cytoscape / React Flow conventions — `data`
 * wrapper because Hindsight surfaces it that way.
 */
export interface EntityGraphNode {
  id: string;
  label: string;
  mentionCount?: number;
  color?: string;
  /** Free-form passthrough so providers can ship extra fields without breaking the type. */
  [key: string]: unknown;
}

export interface EntityGraphEdge {
  id: string;
  source: string;
  target: string;
  /** "cooccurrence" | "entity" | provider-specific */
  linkType?: string;
  weight?: number;
  color?: string;
  lastCooccurred?: string;
  [key: string]: unknown;
}

export interface EntityGraph {
  nodes: EntityGraphNode[];
  edges: EntityGraphEdge[];
}

/**
 * Memory-level graph — nodes are MEMORIES (not entities), edges are the real
 * relationships Hindsight precomputes: `semantic` (embedding similarity),
 * `temporal` (time-based), `entity` (shared entities). Powers the constellation
 * view. Node id === the memory/unit id from listMemories, so callers can
 * cross-reference against their own memory list.
 */
export interface MemoryGraphNode {
  id: string;
  /** Canonical entity names Hindsight extracted for this memory. */
  entities?: string[];
  /** Hindsight fact type: "world" | "experience" | "observation". */
  factType?: string;
  tags?: string[];
}
export interface MemoryGraphEdge {
  source: string;
  target: string;
  /** "semantic" | "temporal" | "entity". */
  linkType: string;
  weight?: number;
}
export interface MemoryGraph {
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
}

export interface EnsureBankOpts {
  mission?: string;
  /**
   * Plain-language steering for the provider's retain-time extraction (what
   * to keep, what to ignore). Providers that support it (Hindsight
   * `retain_mission`) apply it as bank config; others ignore it. Callers
   * build it from the agent's description — see buildRetainMission in the
   * hindsight provider.
   */
  retainMission?: string;
  /** Enable Hindsight's observation layer (evolution/consolidation memories) for
   *  this bank. Default OFF (avoids ~2× duplication). The Digital Twin bank turns
   *  this ON for temporal/evolution tracking, scoping observations per-user via
   *  RetainItem.observationScopes. */
  enableObservations?: boolean;
  /** Named retain strategies to register on the bank: `{ name: {configOverrides} }`.
   *  Items can then select one via RetainItem.strategy. Hindsight-only; the
   *  overrides may set any bank-configurable field (e.g.
   *  `retain_extraction_mode: "chunks"` to store content as-is with no LLM). */
  retainStrategies?: Record<string, Record<string, unknown>>;
}

/**
 * MemoryProvider — the contract every memory backend implements.
 *
 * Required methods are core retention + retrieval. Optional methods sit on
 * the prototype only when `capabilities.{flag}` is true; callers must check
 * the flag before invoking.
 */
export interface MemoryProvider {
  /** Stable identifier — used in logs, audit, per-agent provider overrides. */
  readonly name: string;
  readonly capabilities: ProviderCapabilities;

  /** Make sure a bank exists. Should be idempotent / cached internally. */
  ensureBank(bankId: string, opts?: EnsureBankOpts): Promise<void>;

  /** Store new memories. Provider may extract / chunk / re-embed internally. */
  retain(bankId: string, items: RetainItem[]): Promise<RetainedMemory[]>;

  /** Similarity-style retrieval. Returns ranked memories. */
  recall(bankId: string, query: string, opts?: RecallOpts): Promise<RecalledMemory[]>;

  /** Paginated browse — used by admin Memory tab. */
  listMemories(bankId: string, filter?: ListFilter): Promise<PaginatedMemories>;

  /** Fetch one memory by id. Optional — some providers can't lookup-by-id efficiently. */
  getMemory?(bankId: string, memoryId: string): Promise<Memory | null>;

  /** Hard delete. Required for the HITL force-delete and rejection paths. */
  deleteMemory(bankId: string, memoryId: string): Promise<void>;

  /**
   * Bulk hard-delete every memory carrying `tag`. Returns the count deleted.
   * Used by the digital-twin "delete my memories" flow: per-memory ids aren't
   * tracked in our DB (async retain returns none, so candidate.hindsightMemoryId
   * is always null), which makes per-id delete unable to reach them. Deleting by
   * tag reaches every memory regardless. Optional — callers feature-detect.
   */
  deleteByTag?(bankId: string, tag: string): Promise<number>;

  /**
   * Hard-delete EVERY memory in the bank. The bank row and config overrides
   * survive. Optional — callers feature-detect and own authorization.
   */
  clearAll?(bankId: string): Promise<number>;

  /** Capable providers only. Capability flag: `reflect`. */
  reflect?(bankId: string, query: string): Promise<ReflectResult>;

  /** Entity-relationship graph for the bank. Capable providers only — flag: `entityGraph`. */
  getEntityGraph?(bankId: string): Promise<EntityGraph>;

  /** Memory-level graph (nodes = memories, edges = semantic/temporal/entity links)
   *  for the constellation view. `opts.tags` scopes to a subset (e.g. one user);
   *  Hindsight filters these at the SQL layer. Optional — callers feature-detect. */
  getMemoryGraph?(bankId: string, opts?: { tags?: string[]; limit?: number }): Promise<MemoryGraph>;

  /** Prior versions of one memory, newest first. Providers without version
   *  history omit this method entirely; callers must feature-detect. Returns []
   *  (not an error) for a memory that simply has no history. */
  getMemoryHistory?(bankId: string, memoryId: string): Promise<MemoryHistoryEntry[]>;

  /**
   * Ask the provider to (re)derive higher-order memories from raw facts.
   *
   * Async: returns once the job is QUEUED, not once it has run. `deduplicated`
   * is true when an equivalent job was already pending and this call joined it
   * rather than adding another.
   *
   * `observationScopes` restricts the run to facts carrying all tags in at
   * least one scope — e.g. `[["user:abc"]]`. REQUIRED in practice on a shared
   * multi-user bank: an unscoped run consolidates every user's facts.
   */
  consolidate?(
    bankId: string,
    opts?: { observationScopes?: string[][] },
  ): Promise<{ operationId: string; deduplicated: boolean }>;
}

/** Convert an agent slug into a stable bank id usable by every provider. */
export function bankIdForAgent(agentSlug: string): string {
  const sanitized = agentSlug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 44);
  return `xyne-${sanitized}`;
}

/** Org-scoped bank id: `xyne-<org8>-<slug>`. org8 = first 8 lowercased alphanumeric chars of orgId. Multi-org fix (2026-07-17): slug-only bank ids made same-slug agents in different orgs share one memory bank. */
export function bankIdForAgentOrg(agentSlug: string, orgId: string): string {
  const sanitized = agentSlug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 44);
  const org8 = orgId.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
  return `xyne-${org8}-${sanitized}`;
}
