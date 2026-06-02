/**
 * StubMemoryProvider — in-process Map-based provider for tests and local
 * dev when no real memory backend is available.
 *
 * Deterministic, ephemeral, zero external dependencies. Recall is a naive
 * substring match (no vectors, no scoring) — good enough to verify HITL
 * orchestration, route plumbing, and UI without needing Hindsight running.
 *
 * Declares all capabilities as false so the HITL layer doesn't expose
 * advanced features (Reflect, graph) for stub-backed agents.
 */

import type {
  EnsureBankOpts,
  ListFilter,
  Memory,
  MemoryProvider,
  PaginatedMemories,
  ProviderCapabilities,
  RecallOpts,
  RecalledMemory,
  RetainItem,
  RetainedMemory,
} from "../types.js";

const CAPABILITIES: ProviderCapabilities = {
  reflect: false,
  entityGraph: false,
  temporal: false,
  multilingual: false,
  tagGroups: false,
  sparseRetrieval: false,
};

interface StubMemory {
  id: string;
  content: string;
  tags: string[];
  metadata: Record<string, string>;
  createdAt: string;
}

export class StubMemoryProvider implements MemoryProvider {
  readonly name = "stub";
  readonly capabilities = CAPABILITIES;

  private readonly banks = new Map<string, Map<string, StubMemory>>();
  private nextId = 1;

  async ensureBank(bankId: string, _opts: EnsureBankOpts = {}): Promise<void> {
    if (!this.banks.has(bankId)) this.banks.set(bankId, new Map());
  }

  async retain(bankId: string, items: RetainItem[]): Promise<RetainedMemory[]> {
    await this.ensureBank(bankId);
    const bank = this.banks.get(bankId);
    if (!bank) return [];

    const out: RetainedMemory[] = [];
    for (const item of items) {
      const id = `stub-${this.nextId++}`;
      const mem: StubMemory = {
        id,
        content: item.content,
        tags: item.tags ?? [],
        metadata: item.metadata ?? {},
        createdAt: new Date().toISOString(),
      };
      bank.set(id, mem);
      out.push({ id, content: mem.content, tags: mem.tags });
    }
    return out;
  }

  async recall(bankId: string, query: string, opts: RecallOpts = {}): Promise<RecalledMemory[]> {
    const bank = this.banks.get(bankId);
    if (!bank) return [];

    const tagFilter = opts.tags && opts.tags.length > 0 ? new Set(opts.tags) : null;
    const q = query.toLowerCase().trim();
    const all = Array.from(bank.values()).filter((m) => {
      if (tagFilter && !m.tags.some((t) => tagFilter.has(t))) return false;
      return q.length === 0 || m.content.toLowerCase().includes(q);
    });

    const limit = budgetToLimit(opts.budget);
    return all.slice(0, limit).map((m, i) => ({
      id: m.id,
      text: m.content,
      tags: m.tags,
      score: 1 - i * 0.1,
    }));
  }

  async listMemories(bankId: string, filter: ListFilter = {}): Promise<PaginatedMemories> {
    const bank = this.banks.get(bankId);
    if (!bank) return { memories: [], total: 0 };

    const search = filter.search?.toLowerCase().trim();
    const tagFilter = filter.tags && filter.tags.length > 0 ? new Set(filter.tags) : null;

    let all = Array.from(bank.values()).filter((m) => {
      if (tagFilter && !m.tags.some((t) => tagFilter.has(t))) return false;
      if (search && !m.content.toLowerCase().includes(search)) return false;
      return true;
    });

    const total = all.length;
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? 50;
    all = all.slice(offset, offset + limit);

    return {
      memories: all.map((m) => ({
        id: m.id,
        content: m.content,
        tags: m.tags,
        metadata: m.metadata,
        createdAt: m.createdAt,
      })),
      total,
    };
  }

  async getMemory(bankId: string, memoryId: string): Promise<Memory | null> {
    const bank = this.banks.get(bankId);
    if (!bank) return null;
    const mem = bank.get(memoryId);
    if (!mem) return null;
    return {
      id: mem.id,
      content: mem.content,
      tags: mem.tags,
      metadata: mem.metadata,
      createdAt: mem.createdAt,
    };
  }

  async deleteMemory(bankId: string, memoryId: string): Promise<void> {
    const bank = this.banks.get(bankId);
    if (bank) bank.delete(memoryId);
  }

  /** Test helper: clear all banks. Not part of the MemoryProvider interface. */
  reset(): void {
    this.banks.clear();
    this.nextId = 1;
  }

  /** Test helper: introspect for assertions. Not part of the interface. */
  dumpBank(bankId: string): StubMemory[] {
    return Array.from(this.banks.get(bankId)?.values() ?? []);
  }
}

function budgetToLimit(budget: RecallOpts["budget"]): number {
  if (budget === "high") return 20;
  if (budget === "mid") return 10;
  return 5;
}
