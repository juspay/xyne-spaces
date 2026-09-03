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
  MemoryGraph,
  MemoryGraphEdge,
  MemoryGraphNode,
  MemoryHistoryEntry,
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

import { createLogger } from "../../logger.js";
const log = createLogger("hindsight");

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
  /** Per-item observation scoping (see RetainItem.observationScopes). A list of
   *  tag-lists → one consolidation pass per inner list. */
  observation_scopes?: string[][];
  /** Named strategy registered on the bank; selects per-item config overrides. */
  strategy?: string;
  entities?: Array<{ text: string; type?: string }>;
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

// Per-operation HTTP timeouts (ms), env-tunable so a slow / self-hosted
// Hindsight can be given headroom without a code change. Reads (recall/list)
// and reflect default higher because `recall` sits on the twin respond-gate +
// agent memory-search hot paths and was timing out at 10s.
const timeoutMs = (envVar: string, fallback: number): number => {
  const n = Number(process.env[envVar]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const DEFAULT_TIMEOUT_MS = {
  ensure: timeoutMs("HINDSIGHT_ENSURE_TIMEOUT_MS", 15_000),
  // Retain runs async on Hindsight's side (returns operation_id immediately
  // and processes extraction in the background). 60s buffer covers the
  // request-acceptance round-trip even for very large transcript blobs.
  retain: timeoutMs("HINDSIGHT_RETAIN_TIMEOUT_MS", 60_000),
  // Recall latency scales with bank size: a 2k-fact bank answers in 7-11s
  // (measured 2026-07-17). Default 60s gives generous headroom on the gate +
  // agent memory-search hot paths; tune DOWN via env if you want it tighter.
  recall: timeoutMs("HINDSIGHT_RECALL_TIMEOUT_MS", 60_000),
  list: timeoutMs("HINDSIGHT_LIST_TIMEOUT_MS", 30_000),
  delete: timeoutMs("HINDSIGHT_DELETE_TIMEOUT_MS", 10_000),
  reflect: timeoutMs("HINDSIGHT_REFLECT_TIMEOUT_MS", 60_000),
};

export class HindsightProvider implements MemoryProvider {
  readonly name = "hindsight";
  readonly capabilities = CAPABILITIES;

  readonly enabled: boolean;
  private readonly baseUrl: string;
  private readonly tenant: string;
  private readonly headers: Record<string, string>;
  /** bankId → the tuning we last applied in THIS process, serialized. Keyed on
   *  the tuning (not just the id) because several call sites ensure the same
   *  bank with DIFFERENT opts — the twin passes enableObservations + strategies,
   *  generic callers pass neither. A plain id-keyed cache let whichever caller
   *  ran first in a pod decide the bank's config and silently pinned it, so the
   *  twin bank could sit on enable_observations:false with no strategies
   *  registered. Re-tuning when the desired config differs fixes that and makes
   *  newly-added settings take effect without hand-patching the bank. */
  private readonly bankCache = new Map<string, string>();

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
    const tuningKey = JSON.stringify(this.desiredTuning(opts));
    if (this.bankCache.get(bankId) === tuningKey) return;

    try {
      // NOTE: 0.6.2 answers 405 to GET /banks/:id, so the exists-probe always
      // falls through to create-or-409 — harmless, kept for newer versions.
      const res = await fetch(`${this.baseUrl}/v1/${this.tenant}/banks/${bankId}`, {
        method: "GET",
        headers: this.headers,
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS.ensure),
      });
      if (res.ok) {
        // Already exists — make sure tuning matches what we want, then cache.
        await this.applyBankTuning(bankId, opts);
        this.bankCache.set(bankId, tuningKey);
        return;
      }
      const createRes = await fetch(`${this.baseUrl}/v1/${this.tenant}/banks`, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({ id: bankId, mission: opts.mission ?? `Memory bank ${bankId}` }),
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS.ensure),
      });
      if (createRes.ok || createRes.status === 409) {
        await this.applyBankTuning(bankId, opts);
        this.bankCache.set(bankId, tuningKey);
      }
    } catch (err) {
      log.warn(`[hindsight] ensureBank(${bankId}) failed: ${errMsg(err)}`);
    }
  }

  /**
   * Tune Hindsight's bank config for fact-quality extraction:
   *   - enable_observations: OFF by default (the second "observation" pass
   *     ~2x-duplicates world facts; verified experimentally 2026-07-17). Banks
   *     that want evolution/temporal tracking (the Digital Twin) pass
   *     opts.enableObservations=true; observation consolidation is then confined
   *     per-user via RetainItem.observationScopes so a shared bank can't mix users.
   *   - retain_extraction_mode="verbose": richer facts per chunk. Safe for
   *     transcript-sized input; NEVER flip the old blob pipeline to verbose —
   *     verbose over a small dense blob produced ZERO facts twice in testing.
   *   - retain_mission: caller-supplied steering (see EnsureBankOpts).
   *
   * PERSISTENCE GOTCHA (found 2026-07-17): Hindsight materializes the bank
   * row lazily on FIRST retain. A config PATCH before that returns 200 and
   * persists NOTHING — which is why production banks silently ran defaults
   * for months. So this VERIFIES via GET (overrides must contain what we
   * set) and, when the bank is unmaterialized, fires a tiny warmup retain to
   * force materialization, then re-applies. Best-effort — never throws.
   */
  /** The bank config this caller wants. Also the cache key — see bankCache. */
  private desiredTuning(opts: EnsureBankOpts): Record<string, unknown> {
    return {
      // Per-bank: the Digital Twin opts INTO observations (evolution tracking),
      // scoped per-user via observationScopes; every other bank stays OFF.
      enable_observations: opts.enableObservations === true,
      retain_extraction_mode: "verbose",
      ...(opts.retainMission ? { retain_mission: opts.retainMission } : {}),
      ...(opts.retainStrategies ? { retain_strategies: opts.retainStrategies } : {}),
    };
  }

  private async applyBankTuning(bankId: string, opts: EnsureBankOpts = {}): Promise<void> {
    const desired = this.desiredTuning(opts);
    try {
      for (let attempt = 1; attempt <= 3; attempt++) {
        await fetch(this.bankPath(bankId, "/config"), {
          method: "PATCH",
          headers: this.headers,
          body: JSON.stringify({ updates: desired }),
          signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS.ensure),
        });
        if (await this.tuningPersisted(bankId, desired)) {
          if (attempt > 1) log.info(`[hindsight] bank tuning persisted for ${bankId} on attempt ${attempt}`);
          return;
        }
        // Not persisted → bank likely unmaterialized. Warmup retain forces the
        // row into existence; the throwaway content extracts to nothing useful
        // and is tagged for later cleanup.
        if (attempt === 1) {
          await fetch(this.bankPath(bankId, "/memories"), {
            method: "POST",
            headers: this.headers,
            body: JSON.stringify({
              items: [{ content: "bank tuning warmup", timestamp: new Date().toISOString(), tags: ["warmup-tuning"] }],
              async: true,
            }),
            signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS.retain),
          }).catch(() => undefined);
        }
        await new Promise((resolve) => setTimeout(resolve, 3_000));
      }
      log.warn(`[hindsight] bank tuning NOT persisted for ${bankId} after retries — bank runs provider defaults (concise extraction, observations on)`);
    } catch (err) {
      log.warn(`[hindsight] applyBankTuning(${bankId}) failed: ${errMsg(err)}`);
    }
  }

  /** True when every desired key is visible in the bank's stored overrides. */
  private async tuningPersisted(bankId: string, desired: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch(this.bankPath(bankId, "/config"), {
        method: "GET",
        headers: this.headers,
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS.ensure),
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { overrides?: Record<string, unknown> };
      const ov = data.overrides ?? {};
      return Object.entries(desired).every(([k, v]) => JSON.stringify(ov[k]) === JSON.stringify(v));
    } catch {
      return false;
    }
  }

  async retain(bankId: string, items: RetainItem[]): Promise<RetainedMemory[]> {
    if (!this.enabled || items.length === 0) return [];

    const body: { items: HindsightRetainItem[]; async: boolean } = {
      items: items.map((it): HindsightRetainItem => ({
        content: it.content,
        // Real event time when the caller supplies it (e.g. the twin passes the
        // source message's timestamp) → Hindsight can rank by recency + answer
        // temporal queries. Falls back to now() otherwise.
        timestamp: it.timestamp ?? new Date().toISOString(),
        ...(it.tags ? { tags: it.tags } : {}),
        ...(it.metadata ? { metadata: it.metadata } : {}),
        ...(it.observationScopes ? { observation_scopes: it.observationScopes } : {}),
        ...(it.strategy ? { strategy: it.strategy } : {}),
        ...(it.entities?.length ? { entities: it.entities } : {}),
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
      ...(opts.preferObservations ? { prefer_observations: true } : {}),
      ...(opts.queryTimestamp ? { query_timestamp: opts.queryTimestamp } : {}),
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
    // Drop soft-retired memories (state=invalidated — see deleteMemory) so a
    // deleted memory disappears from every view (memories tab, count, graph).
    const rawItems = (data.items ?? []).filter((m) => m["state"] !== "invalidated");
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
    // Hindsight exposes NO hard per-id delete — `DELETE /memories/{id}` 405s
    // (the only DELETEs are the bank-wide "clear by type" and per-memory
    // observation-clear). The per-memory removal is a curation op: PATCH the
    // memory to state=invalidated, which soft-retires it (excluded from recall).
    // We also filter invalidated out of listMemories, so from the app's POV it
    // is gone. 404 → already gone (idempotent).
    const res = await fetch(this.bankPath(bankId, `/memories/${memoryId}`), {
      method: "PATCH",
      headers: this.headers,
      body: JSON.stringify({ state: "invalidated", reason: "Deleted by user" }),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS.delete),
    });
    if (!res.ok && res.status !== 404) {
      const txt = await res.text().catch(() => "");
      // Observations are derived from world/experience facts and Hindsight
      // deliberately refuses direct curation. Give callers a stable marker so
      // they can return an actionable response instead of an opaque 500.
      if (
        res.status === 400 &&
        (/\bis an observation\b/i.test(txt) || /only world\/experience facts can be curated/i.test(txt))
      ) {
        throw new Error(
          "HINDSIGHT_DERIVED_OBSERVATION: derived observations cannot be deleted directly; " +
            "invalidate their supporting world/experience facts instead",
        );
      }
      // 405 = this Hindsight deployment predates reversible curation (the PATCH
      // /memories/{id} invalidate endpoint, added upstream 2026-06-10 / PR #1976).
      // There is NO other per-memory delete/invalidate endpoint, so this can only
      // be fixed by upgrading Hindsight — surface that explicitly (marker string
      // `HINDSIGHT_CURATION_UNSUPPORTED` so callers can map it to a clear message
      // instead of an opaque 500) rather than a bare status code.
      if (res.status === 405) {
        throw new Error(
          `HINDSIGHT_CURATION_UNSUPPORTED: this Hindsight deployment does not support ` +
            `per-memory invalidate (PATCH /memories/{id} → 405). Upgrade Hindsight to ` +
            `a build with reversible curation (PR #1976, 2026-06-10) to enable memory deletion.`,
        );
      }
      throw new Error(`Hindsight invalidate ${res.status}: ${txt.slice(0, 200)}`);
    }
  }

  /**
   * Soft-retire every raw world/experience memory carrying `tag`. Derived
   * observations are reconciled asynchronously by Hindsight. Its list endpoint
   * cannot filter by tag, so the shared sweep filters locally.
   */
  async deleteByTag(bankId: string, tag: string): Promise<number> {
    return this.sweepDelete(bankId, tag);
  }

  /**
   * Soft-retire every raw world/experience memory in the bank. The bank row
   * and its config overrides survive; derived observations are reconciled
   * asynchronously by Hindsight. Callers own the authorization.
   */
  async clearAll(bankId: string): Promise<number> {
    return this.sweepDelete(bankId);
  }

  /**
   * Shared sweep: page the RAW list, collect raw fact ids (optionally only
   * those carrying `tag`), then invalidate each. Observations are deliberately
   * skipped because Hindsight rebuilds them from the remaining valid sources.
   * Best-effort per id; returns the count actually retired.
   */
  private async sweepDelete(bankId: string, tag?: string): Promise<number> {
    if (!this.enabled) return 0;
    const PAGE = 500;
    const ids: string[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const res = await fetch(
        this.bankPath(bankId, `/memories/list?limit=${PAGE}&offset=${offset}`),
        { method: "GET", headers: this.headers, signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS.list) },
      );
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Hindsight list ${res.status} during sweepDelete: ${txt.slice(0, 200)}`);
      }
      const data = (await res.json()) as { items?: Array<Record<string, unknown>> };
      const items = data.items ?? [];
      for (const it of items) {
        const tags = (it["tags"] as string[] | undefined) ?? [];
        const id = String(it["id"] ?? "");
        const factType = String(it["fact_type"] ?? it["type"] ?? "").toLowerCase();
        // Observations cannot be invalidated directly. Invalidating the raw
        // world/experience sources below makes Hindsight recompute (or remove)
        // their derived observations asynchronously.
        if (factType === "observation") continue;
        if (id && (!tag || tags.includes(tag))) ids.push(id);
      }
      if (items.length < PAGE) break; // last page
    }
    let deleted = 0;
    for (const id of ids) {
      try {
        await this.deleteMemory(bankId, id);
        deleted += 1;
      } catch {
        // best-effort — a single failed delete shouldn't abort the sweep
      }
    }
    return deleted;
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

  /**
   * Memory graph — nodes are MEMORIES, edges are Hindsight's precomputed
   * `semantic` / `temporal` / `entity` links. Cytoscape shape ({data:{…}} wrappers)
   * unwrapped to flat. `entities` + `color` live on node.data; `tags` + `fact_type`
   * live on table_rows (joined by id here). `tags` are filtered SQL-side by
   * Hindsight (all_strict), so passing `["user:<id>"]` scopes to one user reliably.
   */
  /**
   * Prior versions of ONE memory, newest first.
   *
   * Hindsight's endpoint is `get_observation_history` despite the generic URL:
   * it returns [] for anything whose fact_type isn't "observation", so raw
   * world/experience facts always come back empty. There is no batch form —
   * one call per memory id — which is why callers should only ask for memories
   * that can actually have history.
   */
  async getMemoryHistory(bankId: string, memoryId: string): Promise<MemoryHistoryEntry[]> {
    if (!this.enabled) return [];
    const res = await fetch(
      this.bankPath(bankId, `/memories/${encodeURIComponent(memoryId)}/history`),
      { method: "GET", headers: this.headers, signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS.list) },
    );
    // A memory with no history and a memory that vanished are both "nothing to
    // show" as far as the UI is concerned — neither is worth an error.
    if (res.status === 404) return [];
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Hindsight getMemoryHistory ${res.status}: ${txt.slice(0, 200)}`);
    }
    const body = (await res.json()) as unknown;
    const rows = Array.isArray(body)
      ? body
      : ((body as { history?: unknown[] })?.history ?? []);
    return (rows as Array<Record<string, unknown>>).map((r) => ({
      previousText: String(r["previous_text"] ?? ""),
      ...(Array.isArray(r["previous_tags"]) ? { previousTags: r["previous_tags"] as string[] } : {}),
      ...(r["previous_mentioned_at"] ? { previousMentionedAt: String(r["previous_mentioned_at"]) } : {}),
      changedAt: String(r["changed_at"] ?? ""),
      ...(Array.isArray(r["source_facts"])
        ? {
            sourceFacts: (r["source_facts"] as Array<Record<string, unknown>>).map((f) => ({
              id: String(f["id"] ?? ""),
              text: String(f["text"] ?? ""),
            })),
          }
        : {}),
    }));
  }

  /**
   * Queue a consolidation run. Hindsight normally schedules this itself after
   * every retain (gated on the bank's enable_observations +
   * enable_auto_consolidation), so this exists for the cases that gating leaves
   * behind: a backlog built up while observations were disabled, facts stranded
   * by a terminal failure, and deterministic testing.
   *
   * Scoped runs skip Hindsight's bank-level dedupe, so they are never merged
   * into a pending full-bank sweep.
   */
  async consolidate(
    bankId: string,
    opts?: { observationScopes?: string[][] },
  ): Promise<{ operationId: string; deduplicated: boolean }> {
    if (!this.enabled) return { operationId: "", deduplicated: false };
    const res = await fetch(this.bankPath(bankId, "/consolidate"), {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(
        opts?.observationScopes ? { observation_scopes: opts.observationScopes } : {},
      ),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS.ensure),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Hindsight consolidate ${res.status}: ${txt.slice(0, 200)}`);
    }
    const body = (await res.json()) as { operation_id?: string; deduplicated?: boolean };
    return {
      operationId: String(body.operation_id ?? ""),
      deduplicated: body.deduplicated === true,
    };
  }

  async getMemoryGraph(bankId: string, opts?: { tags?: string[]; limit?: number }): Promise<MemoryGraph> {
    if (!this.enabled) return { nodes: [], edges: [] };
    const params = new URLSearchParams();
    for (const t of opts?.tags ?? []) params.append("tags", t);
    if (opts?.tags?.length) params.set("tags_match", "all_strict");
    params.set("limit", String(opts?.limit ?? 2000));
    const res = await fetch(this.bankPath(bankId, `/graph?${params.toString()}`), {
      method: "GET",
      headers: this.headers,
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS.list),
    });
    if (!res.ok) {
      if (res.status === 404) return { nodes: [], edges: [] };
      const txt = await res.text().catch(() => "");
      throw new Error(`Hindsight getMemoryGraph ${res.status}: ${txt.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      nodes?: Array<{ data?: Record<string, unknown> }>;
      edges?: Array<{ data?: Record<string, unknown> }>;
      table_rows?: Array<Record<string, unknown>>;
    };
    // table_rows carry tags + fact_type per unit (node.data does not).
    const rowById = new Map<string, Record<string, unknown>>();
    for (const r of data.table_rows ?? []) {
      const id = r["id"];
      if (typeof id === "string") rowById.set(id, r);
    }
    const nodes: MemoryGraphNode[] = (data.nodes ?? [])
      .map((n) => n.data ?? {})
      .filter((d): d is Record<string, unknown> => typeof d === "object" && d !== null && typeof d["id"] === "string")
      .map((d) => {
        const id = d["id"] as string;
        const row = rowById.get(id);
        const entsStr = typeof d["entities"] === "string" ? (d["entities"] as string) : "";
        const entities =
          entsStr && entsStr !== "None" ? entsStr.split(",").map((s) => s.trim()).filter(Boolean) : [];
        const tags = Array.isArray(row?.["tags"])
          ? (row!["tags"] as unknown[]).filter((t): t is string => typeof t === "string")
          : [];
        const factType = typeof row?.["fact_type"] === "string" ? (row!["fact_type"] as string) : undefined;
        return {
          id,
          ...(entities.length ? { entities } : {}),
          ...(factType ? { factType } : {}),
          ...(tags.length ? { tags } : {}),
        };
      });
    const edges: MemoryGraphEdge[] = (data.edges ?? [])
      .map((e) => e.data ?? {})
      .filter(
        (d): d is Record<string, unknown> =>
          typeof d === "object" &&
          d !== null &&
          typeof d["source"] === "string" &&
          typeof d["target"] === "string" &&
          typeof d["linkType"] === "string",
      )
      .map((d) => ({
        source: d["source"] as string,
        target: d["target"] as string,
        linkType: d["linkType"] as string,
        ...(typeof d["weight"] === "number" ? { weight: d["weight"] } : {}),
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
  // Hindsight serializes entities as one comma-joined string, "" when none.
  const rawEntities = m["entities"];
  const entities =
    typeof rawEntities === "string"
      ? rawEntities.split(",").map((e) => e.trim()).filter(Boolean)
      : Array.isArray(rawEntities)
        ? (rawEntities as unknown[]).map((e) => String(e)).filter(Boolean)
        : [];
  return {
    id: String(m["id"] ?? ""),
    content: String(m["text"] ?? m["content"] ?? ""),
    ...(m["tags"] ? { tags: m["tags"] as string[] } : {}),
    ...(m["metadata"] ? { metadata: m["metadata"] as Record<string, string> } : {}),
    ...((m["fact_type"] ?? m["type"]) ? { factType: (m["fact_type"] ?? m["type"]) as string } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(entities.length ? { entities } : {}),
    ...(typeof m["proof_count"] === "number" ? { proofCount: m["proof_count"] as number } : {}),
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
