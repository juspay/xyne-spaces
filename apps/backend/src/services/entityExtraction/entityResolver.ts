import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';
import { normalize, type Mention } from '@/services/entityExtraction/pipeline';

/**
 * Turns raw typed mentions into entities in the registry — the "one entity,
 * many names" step. No LLM, no batch clustering: each distinct surface form is
 * resolved against the registry (exact, then pg_trgm fuzzy) and either linked to
 * an existing entity or used to create a new one.
 *
 * This is the same code path the steady-state resolver would use; bootstrapping
 * a channel is just running it over that channel's mentions.
 */

/** pg_trgm similarity at/above which a mention links to an existing entity. */
const FUZZY_THRESHOLD = 0.55;

export interface ResolveStats {
  mentions: number;
  uniqueForms: number;
  exactHits: number;
  fuzzyHits: number;
  created: number;
}

/** An entity a document's mentions resolved to, for the Vespa write-back. */
export interface ResolvedRef {
  entityId: string;
  surfaceForm: string;
}

export interface ResolveResult {
  stats: ResolveStats;
  /** docId (SourceDocument id) → the entities its mentions resolved to. */
  byDoc: Map<string, ResolvedRef[]>;
}

interface FormGroup {
  type: string;
  normalizedForm: string;
  span: string; // most frequent raw span, used as the display/canonical name
  count: number;
  docIds: string[]; // documents this form appeared in, for the write-back
}

class EntityResolver {
  private prisma = DatabaseClient.getInstance();

  /**
   * Resolve a batch of mentions into the registry. Distinct (type, normalized
   * form) pairs are resolved once; case/spacing variants of a span collapse here
   * because they share a normalized form. Returns the doc→entity map so the
   * caller can write entity ids back onto the source documents.
   */
  async resolveMentions(workspaceId: string, mentions: Mention[]): Promise<ResolveResult> {
    const groups = this.groupByForm(mentions);

    const stats: ResolveStats = {
      mentions: mentions.length,
      uniqueForms: groups.length,
      exactHits: 0,
      fuzzyHits: 0,
      created: 0,
    };
    const byDoc = new Map<string, ResolvedRef[]>();

    // Sequential on purpose: resolving "zakpay" right after "zaakpay" must see
    // the entity the latter just created, so the typo links instead of forking
    // a duplicate. Concurrency would reintroduce the create-race we rely on the
    // unique constraint to catch.
    for (const g of groups) {
      const { outcome, entityId } = await this.resolveOne(workspaceId, g);
      stats[outcome]++;
      for (const docId of g.docIds) {
        const refs = byDoc.get(docId) ?? [];
        refs.push({ entityId, surfaceForm: g.span });
        byDoc.set(docId, refs);
      }
    }

    logger.info('[ENTITY_RESOLVER] resolved', { workspaceId, ...stats });
    return { stats, byDoc };
  }

  /** Collapse mentions to unique (type, normalizedForm); pick the commonest raw span. */
  private groupByForm(mentions: Mention[]): FormGroup[] {
    const map = new Map<
      string,
      {
        type: string;
        normalizedForm: string;
        count: number;
        spanCounts: Map<string, number>;
        docIds: Set<string>;
      }
    >();

    for (const m of mentions) {
      const normalizedForm = normalize(m.span);
      if (!normalizedForm) continue;
      const key = `${m.type} ${normalizedForm}`;
      let g = map.get(key);
      if (!g) {
        g = { type: m.type, normalizedForm, count: 0, spanCounts: new Map(), docIds: new Set() };
        map.set(key, g);
      }
      g.count++;
      g.spanCounts.set(m.span, (g.spanCounts.get(m.span) ?? 0) + 1);
      g.docIds.add(m.docId);
    }

    return [...map.values()].map((g) => {
      let span = '';
      let best = -1;
      for (const [s, c] of g.spanCounts) {
        if (c > best) {
          best = c;
          span = s;
        }
      }
      return {
        type: g.type,
        normalizedForm: g.normalizedForm,
        span,
        count: g.count,
        docIds: [...g.docIds],
      };
    });
  }

  private async resolveOne(
    workspaceId: string,
    g: FormGroup,
  ): Promise<{ outcome: 'exactHits' | 'fuzzyHits' | 'created'; entityId: string }> {
    // 1. Exact — a known spelling. O(1) via the unique index.
    const exact = await this.prisma.entityAlias.findUnique({
      where: {
        workspaceId_type_normalizedForm: {
          workspaceId,
          type: g.type,
          normalizedForm: g.normalizedForm,
        },
      },
    });
    if (exact) {
      await this.link(exact.id, exact.entityId, g.count);
      return { outcome: 'exactHits', entityId: exact.entityId };
    }

    // 2. Fuzzy — a typo/variant of a known entity, via pg_trgm.
    const match = await this.fuzzyMatch(workspaceId, g.type, g.normalizedForm);
    if (match) {
      await this.addAlias(workspaceId, g.type, match.entityId, g.span, g.normalizedForm, g.count);
      await this.bumpEntity(match.entityId, g.count);
      return { outcome: 'fuzzyHits', entityId: match.entityId };
    }

    // 3. New entity.
    const entityId = await this.createEntity(workspaceId, g);
    return { outcome: 'created', entityId };
  }

  /** Top pg_trgm candidate in the same (workspace, type), gated at the threshold. */
  private async fuzzyMatch(
    workspaceId: string,
    type: string,
    normalizedForm: string,
  ): Promise<{ entityId: string; sim: number } | null> {
    const rows = await this.prisma.$queryRaw<Array<{ entityId: string; sim: number }>>`
      SELECT "entityId", similarity("normalizedForm", ${normalizedForm})::float AS sim
      FROM "non_zero"."entity_aliases"
      WHERE "workspaceId" = ${workspaceId}
        AND "type" = ${type}
        AND "normalizedForm" % ${normalizedForm}
      ORDER BY sim DESC
      LIMIT 1`;
    const top = rows[0];
    return top && top.sim >= FUZZY_THRESHOLD ? top : null;
  }

  /** Create a new entity + its first alias; returns the entity id. */
  private async createEntity(workspaceId: string, g: FormGroup): Promise<string> {
    try {
      const entity = await this.prisma.entity.create({
        data: {
          workspaceId,
          type: g.type,
          canonicalName: g.span,
          normalizedName: g.normalizedForm,
          mentionCount: g.count,
        },
      });
      await this.prisma.entityAlias.create({
        data: {
          workspaceId,
          entityId: entity.id,
          type: g.type,
          surfaceForm: g.span,
          normalizedForm: g.normalizedForm,
          count: g.count,
        },
      });
      return entity.id;
    } catch {
      // Unique violation — another form created this entity between our lookup
      // and insert. Fall back to linking, which is what should have happened.
      const existing = await this.prisma.entity.findUnique({
        where: {
          workspaceId_type_normalizedName: {
            workspaceId,
            type: g.type,
            normalizedName: g.normalizedForm,
          },
        },
      });
      if (!existing) throw new Error(`resolve: create failed and entity not found for ${g.normalizedForm}`);
      await this.addAlias(workspaceId, g.type, existing.id, g.span, g.normalizedForm, g.count);
      await this.bumpEntity(existing.id, g.count);
      return existing.id;
    }
  }

  /** Attach a surface form to an entity (or bump it if it already exists). */
  private async addAlias(
    workspaceId: string,
    type: string,
    entityId: string,
    surfaceForm: string,
    normalizedForm: string,
    count: number,
  ): Promise<void> {
    await this.prisma.entityAlias.upsert({
      where: { workspaceId_type_normalizedForm: { workspaceId, type, normalizedForm } },
      create: { workspaceId, entityId, type, surfaceForm, normalizedForm, count },
      update: { count: { increment: count } },
    });
  }

  private async link(aliasId: string, entityId: string, count: number): Promise<void> {
    await this.prisma.entityAlias.update({
      where: { id: aliasId },
      data: { count: { increment: count } },
    });
    await this.bumpEntity(entityId, count);
  }

  private async bumpEntity(entityId: string, count: number): Promise<void> {
    await this.prisma.entity.update({
      where: { id: entityId },
      data: { mentionCount: { increment: count } },
    });
  }
}

export const entityResolver = new EntityResolver();
