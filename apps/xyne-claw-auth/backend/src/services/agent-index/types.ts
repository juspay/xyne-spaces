/**
 * Agent index — a per-org Hindsight bank holding one searchable document per
 * agent, so the orchestrator can find a specialist by describing the need
 * instead of reading the whole roster.
 *
 * The bank runs in `chunks` extraction mode: content is stored verbatim with no
 * LLM on the write path. See `bank.ts` for the configuration that guarantees it.
 */

/** What an entry describes. Each kind is retained and replaced independently. */
export const INDEX_KINDS = ["identity", "persona", "usage"] as const;
export type IndexKind = (typeof INDEX_KINDS)[number];

/** One renderable document for one agent. */
export interface IndexBlob {
  kind: IndexKind;
  content: string;
  /** Deterministic over `content` — lets sync skip unchanged blobs. */
  contentHash: string;
  tags: string[];
  metadata: Record<string, string>;
}

/** An entry as it currently exists in the bank. */
export interface StoredBlob {
  id: string;
  kind: IndexKind | "unknown";
  slug: string;
  text: string;
  chars: number;
  tags: string[];
  /** `<document>_<ordinal>` — the provider splits a long document into chunks,
   *  and this is what puts them back in order. */
  chunkId: string | null;
  /** The agent-row revision this entry was written from — `retain` is given the
   *  agent's `updatedAt`, and unlike metadata the provider returns it on list. */
  indexedAt: string | null;
  metadata: Record<string, string>;
}

/**
 * One logical document, reassembled from however many chunks the provider split
 * it into. Callers think in documents; chunking is a storage detail.
 */
export interface IndexDocument {
  kind: IndexKind | "unknown";
  slug: string;
  contentHash: string | null;
  text: string;
  chars: number;
  chunks: number;
  indexedAt: string | null;
}

export interface AgentIndexStatus {
  slug: string;
  name: string;
  agentId: string;
  /** Present for every kind the agent should have. */
  indexed: IndexKind[];
  missing: IndexKind[];
  /** Live row is newer than what the bank holds. */
  stale: boolean;
  liveUpdatedAt: string;
  indexedUpdatedAt: string | null;
  promptVersion: number | null;
  indexedPromptVersion: number | null;
  chars: number;
}

/** One agent ranked against a need. */
export interface AgentMatch {
  slug: string;
  agentId: string | null;
  /** Best single-chunk score across this agent's entries — see `search.ts`. */
  score: number;
  matchedKinds: IndexKind[];
  /** The chunk that scored highest, for explaining the match. */
  evidence: string;
  /** What the agent is for. Present once the match has been enriched. */
  identity?: string;
  /** What people actually bring it, when a usage document has been synthesized. */
  usage?: string;
  /** Tool names the agent holds, usable as `requiresCapability` on a later search. */
  capabilities?: string[];
}

export interface SyncOutcome {
  slug: string;
  written: IndexKind[];
  skipped: IndexKind[];
  removed: number;
}
