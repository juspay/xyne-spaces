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

export interface EnsureBankOpts {
  mission?: string;
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

  /** Capable providers only. Capability flag: `reflect`. */
  reflect?(bankId: string, query: string): Promise<ReflectResult>;

  /** Entity-relationship graph for the bank. Capable providers only — flag: `entityGraph`. */
  getEntityGraph?(bankId: string): Promise<EntityGraph>;
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
