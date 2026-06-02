/**
 * HindsightProvider — wraps vectorize-io/hindsight's REST API as a
 * MemoryProvider. Default provider for xyne.
 *
 * Hindsight does the heavy work: LLM-driven fact extraction, entity + relation
 * graph, TEMPR multi-strategy fusion (semantic + keyword + graph + temporal),
 * Reflect for mental-model synthesis. Xyne layers HITL approval + audit on top.
 *
 * All operations no-op when the constructor was passed an empty url (the
 * provider is then trivially "disabled" — caller can detect via `enabled`).
 */

import type {
  EnsureBankOpts,
  EntityGraph,
  EntityGraphEdge,
  EntityGraphNode,
  ListFilter,
  Memory,
  MemoryProvider,
  PaginatedMemories,
  ProviderCapabilities,
  RecallOpts,
  RecalledMemory,
  ReflectResult,
  RetainItem,
  RetainedMemory,
  TagGroup,
} from "../types.js";

export interface HindsightProviderConfig {
  url: string;
  tenant?: string;
  apiKey?: string;
}

interface HindsightRetainItem {
  content: string;
  tags?: string[];
  timestamp: string;
  metadata?: Record<string, string>;
}

interface HindsightRetainResponse {
  memories?: Array<{ id?: string; content?: string; text?: string; tags?: string[] }>;
}

interface HindsightRecallResponse {
  // Hindsight's recall response uses `results`, not `memories`.
  results?: Array<{
    id?: string;
    text?: string;
    content?: string;
    fact_type?: string;
    type?: string;
    tags?: string[];
    score?: number;
  }>;
}

interface HindsightListResponse {
  memories?: Array<{
    id?: string;
    content?: string;
    text?: string;
    tags?: string[];
    fact_type?: string;
    metadata?: Record<string, string>;
    created_at?: string;
  }>;
  total?: number;
}

interface HindsightReflectResponse {
  text?: string;
  reflection?: string;
  citations?: Array<{ memory_id?: string; id?: string; text?: string }>;
}

const CAPABILITIES: ProviderCapabilities = {
  reflect: true,
  entityGraph: true,
  temporal: true,
  multilingual: true,
  tagGroups: true,
  sparseRetrieval: true,
};

const DEFAULT_TIMEOUT_MS = {
  ensure: 5_000,
  // Retain runs async on Hindsight's side (returns operation_id immediately
  // and processes extraction in the background). 60s buffer covers the
  // request-acceptance round-trip even for very large transcript blobs.
  retain: 60_000,
  recall: 10_000,
  list: 10_000,
  delete: 5_000,
  reflect: 30_000,
};

export class HindsightProvider implements MemoryProvider {
  readonly name = "hindsight";
  readonly capabilities = CAPABILITIES;

  readonly enabled: boolean;
  private readonly baseUrl: string;
  private readonly tenant: string;
  private readonly headers: Record<string, string>;
  private readonly bankCache = new Set<string>();

  constructor(config: HindsightProviderConfig) {
    this.baseUrl = config.url.replace(/\/+$/, "");
    this.tenant = config.tenant ?? "default";
    this.enabled = Boolean(config.url);
    this.headers = {
      "Content-Type": "application/json",
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    };
  }

  private bankPath(bankId: string, resource: string): string {
    return `${this.baseUrl}/v1/${this.tenant}/banks/${bankId}${resource}`;
  }

  async ensureBank(bankId: string, opts: EnsureBankOpts = {}): Promise<void> {
    if (!this.enabled) return;
    if (this.bankCache.has(bankId)) return;

    try {
      const res = await fetch(`${this.baseUrl}/v1/${this.tenant}/banks/${bankId}`, {
        method: "GET",
        headers: this.headers,
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS.ensure),
      });
      if (res.ok) {
        // Already exists — make sure tuning matches what we want, then cache.
        await this.applyBankTuning(bankId);
        this.bankCache.add(bankId);
        return;
      }
      const createRes = await fetch(`${this.baseUrl}/v1/${this.tenant}/banks`, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({ id: bankId, mission: opts.mission ?? `Memory bank ${bankId}` }),
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS.ensure),
      });
      if (createRes.ok || createRes.status === 409) {
        await this.applyBankTuning(bankId);
        this.bankCache.add(bankId);
      }
    } catch (err) {
      console.warn(`[hindsight] ensureBank(${bankId}) failed: ${errMsg(err)}`);
    }
  }

  /**
   * Tune Hindsight's bank config to suit our curator-driven flow:
   *   - enable_observations=false: prevents Hindsight from running a second
   *     extraction pass that produces near-duplicate "observation" memories
   *     for every "world" fact (gives ~2x duplication otherwise).
   *
   * Best-effort — non-fatal if Hindsight rejects the patch or the endpoint
   * isn't available. The bank still works, just with the default config.
   */
  private async applyBankTuning(bankId: string): Promise<void> {
    try {
      await fetch(this.bankPath(bankId, "/config"), {
        method: "PATCH",
        headers: this.headers,
        body: JSON.stringify({ updates: { enable_observations: false } }),
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS.ensure),
      });
    } catch (err) {
      console.warn(`[hindsight] applyBankTuning(${bankId}) failed: ${errMsg(err)}`);
    }
  }

  async retain(bankId: string, items: RetainItem[]): Promise<RetainedMemory[]> {
    if (!this.enabled || items.length === 0) return [];

    const body: { items: HindsightRetainItem[]; async: boolean } = {
      items: items.map((it): HindsightRetainItem => ({
        content: it.content,
        timestamp: new Date().toISOString(),
        ...(it.tags ? { tags: it.tags } : {}),
        ...(it.metadata ? { metadata: it.metadata } : {}),
      })),
      // Async retain: Hindsight queues the LLM extraction in the background
      // and returns an operation_id immediately. For long sessions the sync
      // path easily exceeds 30s waiting for entity + fact extraction +
      // embedding. Memories surface in recall once the operation completes
      // (typically <2 min, watch /operations/{id} if you want to poll).
      async: true,
    };

    // Hindsight's retain endpoint is POST /memories (not /memories/retain).
    const res = await fetch(this.bankPath(bankId, "/memories"), {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS.retain),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Hindsight retain ${res.status}: ${txt.slice(0, 200)}`);
    }

    const data = (await res.json()) as HindsightRetainResponse;
    return (data.memories ?? []).map((m) => ({
      id: m.id ?? "",
      content: m.content ?? m.text ?? "",
      tags: m.tags ?? [],
    }));
  }

  async recall(bankId: string, query: string, opts: RecallOpts = {}): Promise<RecalledMemory[]> {
    if (!this.enabled) return [];

    const body: Record<string, unknown> = {
      query: query.slice(0, 1000),
      budget: opts.budget ?? "low",
      ...(opts.tags?.length ? { tags: opts.tags } : {}),
      ...(opts.tagGroups ? { tag_groups: serializeTagGroup(opts.tagGroups) } : {}),
      ...(opts.types?.length ? { types: opts.types } : {}),
      ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    };

    const res = await fetch(this.bankPath(bankId, "/memories/recall"), {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS.recall),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Hindsight recall ${res.status}: ${txt.slice(0, 200)}`);
    }

    const data = (await res.json()) as HindsightRecallResponse;
    return (data.results ?? []).map((m) => {
      const factType = m.fact_type ?? m.type;
      return {
        id: m.id ?? "",
        text: m.text ?? m.content ?? "",
        ...(factType ? { factType } : {}),
        ...(m.tags ? { tags: m.tags } : {}),
        ...(typeof m.score === "number" ? { score: m.score } : {}),
      };
    });
  }

  async listMemories(bankId: string, filter: ListFilter = {}): Promise<PaginatedMemories> {
    if (!this.enabled) return { memories: [] };

    // Hindsight's GET /memories/list supports: limit, offset, q (search),
    // type, consolidation_state. It does NOT support tag filtering, and the
    // response uses `items` (not `memories`). When the caller wants tag
    // filtering, we fetch a wider page and post-filter client-side.
    const hasTagFilter = (filter.tags?.length ?? 0) > 0;
    const params = new URLSearchParams();
    if (filter.offset) params.set("offset", String(filter.offset));
    if (filter.search) params.set("q", filter.search);
    // When tag-filtering, fetch a larger page since we'll throw out non-matches.
    const requestedLimit = filter.limit ?? 50;
    params.set("limit", String(hasTagFilter ? Math.max(requestedLimit * 10, 200) : requestedLimit));

    const path = `/memories/list?${params.toString()}`;
    const res = await fetch(this.bankPath(bankId, path), {
      method: "GET",
      headers: this.headers,
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS.list),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Hindsight list ${res.status}: ${txt.slice(0, 200)}`);
    }
    // Hindsight returns { items: [...], total, limit, offset } — not `memories`.
    const data = (await res.json()) as {
      items?: Array<Record<string, unknown>>;
      total?: number;
    };
    const rawItems = data.items ?? [];
    let mapped = rawItems.map((m) => mapMemory(m));

    // Client-side tag filter — Hindsight's list endpoint can't do this for us.
    if (hasTagFilter) {
      const wanted = new Set(filter.tags!);
      mapped = mapped.filter((m) => (m.tags ?? []).some((t) => wanted.has(t)));
      // When we filtered client-side, the upstream `total` no longer reflects
      // the user's view. Recompute conservatively.
      const filteredTotal = mapped.length;
      mapped = mapped.slice(0, requestedLimit);
      return { memories: mapped, total: filteredTotal };
    }

    return {
      memories: mapped,
      ...(typeof data.total === "number" ? { total: data.total } : {}),
    };
  }

  async getMemory(bankId: string, memoryId: string): Promise<Memory | null> {
    if (!this.enabled) return null;
    const res = await fetch(this.bankPath(bankId, `/memories/${memoryId}`), {
      method: "GET",
      headers: this.headers,
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS.list),
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Hindsight get ${res.status}: ${txt.slice(0, 200)}`);
    }
    const data = (await res.json()) as HindsightListResponse["memories"] extends Array<infer U> ? U : never;
    return mapMemory(data as Record<string, unknown>);
  }

  async deleteMemory(bankId: string, memoryId: string): Promise<void> {
    if (!this.enabled) return;
    const res = await fetch(this.bankPath(bankId, `/memories/${memoryId}`), {
      method: "DELETE",
      headers: this.headers,
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS.delete),
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`Hindsight delete ${res.status}`);
    }
  }

  /**
   * Fetch the entity cooccurrence graph for a bank. Hindsight returns nodes
   * (canonical entities) and edges (typed cooccurrence relations). Wraps
   * each entry in a `data` object — we unwrap to a flat shape for callers.
   */
  async getEntityGraph(bankId: string): Promise<EntityGraph> {
    if (!this.enabled) return { nodes: [], edges: [] };
    const res = await fetch(this.bankPath(bankId, "/entities/graph"), {
      method: "GET",
      headers: this.headers,
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS.list),
    });
    if (!res.ok) {
      if (res.status === 404) return { nodes: [], edges: [] };
      const txt = await res.text().catch(() => "");
      throw new Error(`Hindsight getEntityGraph ${res.status}: ${txt.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      nodes?: Array<{ data?: Record<string, unknown> }>;
      edges?: Array<{ data?: Record<string, unknown> }>;
    };
    const nodes: EntityGraphNode[] = (data.nodes ?? [])
      .map((n) => n.data ?? {})
      .filter((d): d is Record<string, unknown> => typeof d === "object" && d !== null && typeof d["id"] === "string")
      .map((d) => ({
        id: d["id"] as string,
        label: typeof d["label"] === "string" ? d["label"] : String(d["id"]),
        ...(typeof d["mentionCount"] === "number" ? { mentionCount: d["mentionCount"] } : {}),
        ...(typeof d["color"] === "string" ? { color: d["color"] } : {}),
      }));
    const edges: EntityGraphEdge[] = (data.edges ?? [])
      .map((e) => e.data ?? {})
      .filter(
        (d): d is Record<string, unknown> =>
          typeof d === "object" &&
          d !== null &&
          typeof d["id"] === "string" &&
          typeof d["source"] === "string" &&
          typeof d["target"] === "string",
      )
      .map((d) => ({
        id: d["id"] as string,
        source: d["source"] as string,
        target: d["target"] as string,
        ...(typeof d["linkType"] === "string" ? { linkType: d["linkType"] } : {}),
        ...(typeof d["weight"] === "number" ? { weight: d["weight"] } : {}),
        ...(typeof d["color"] === "string" ? { color: d["color"] } : {}),
        ...(typeof d["lastCooccurred"] === "string" ? { lastCooccurred: d["lastCooccurred"] } : {}),
      }));
    return { nodes, edges };
  }

  async reflect(bankId: string, query: string): Promise<ReflectResult> {
    if (!this.enabled) return { text: "" };
    const res = await fetch(this.bankPath(bankId, "/reflect"), {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS.reflect),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Hindsight reflect ${res.status}: ${txt.slice(0, 200)}`);
    }
    const data = (await res.json()) as HindsightReflectResponse;
    return {
      text: data.text ?? data.reflection ?? "",
      ...(data.citations
        ? {
            citations: data.citations.map((c) => ({
              memoryId: c.memory_id ?? c.id ?? "",
              text: c.text ?? "",
            })),
          }
        : {}),
    };
  }
}

function mapMemory(m: Record<string, unknown>): Memory {
  // Hindsight returns: { id, text, context, date, fact_type, mentioned_at,
  //   occurred_start, occurred_end, entities, chunk_id, proof_count, tags }
  // No top-level `content` / `created_at` / `metadata` keys.
  const createdAt = (m["date"] ?? m["created_at"] ?? m["mentioned_at"]) as
    | string
    | undefined;
  return {
    id: String(m["id"] ?? ""),
    content: String(m["text"] ?? m["content"] ?? ""),
    ...(m["tags"] ? { tags: m["tags"] as string[] } : {}),
    ...(m["metadata"] ? { metadata: m["metadata"] as Record<string, string> } : {}),
    ...(m["fact_type"] ? { factType: m["fact_type"] as string } : {}),
    ...(createdAt ? { createdAt } : {}),
  };
}

function serializeTagGroup(g: TagGroup): Record<string, unknown> {
  if ("tags" in g) {
    return { tags: g.tags, ...(g.match ? { match: g.match } : {}) };
  }
  if ("and" in g) return { and: g.and.map(serializeTagGroup) };
  if ("or" in g) return { or: g.or.map(serializeTagGroup) };
  return { not: serializeTagGroup(g.not) };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
