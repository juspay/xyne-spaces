import { DatabaseClient } from '../client';
import { Prisma, Tag, TagsConfig } from '@prisma/client';
import { TagMethod } from '@xyne/shared';
import { logger } from '../../utils/logger';

export type TxClient = Prisma.TransactionClient;

export interface MirrorTagRow {
  tagCategory: string;
  tag: string;
  method: string;
  reason?: string | null;
}

interface InsertConfigRowData {
  configKey: string;
  sourceType: string;
  workspaceId: string;
  config: Prisma.InputJsonValue;
  createdBy?: string | null;
  updatedBy?: string | null;
}

interface InsertTagRowData {
  sourceId: string;
  sourceType: string;
  workspaceId: string;
  configKey?: string | null;
  tagCategory: string;
  tag: string;
  method: TagMethod;
  reason?: string | null;
  createdBy?: string | null;
  updatedBy?: string | null;
}

export class TagRepository {
  private db = DatabaseClient.getInstance();

  getDb() {
    return this.db;
  }

  private client(tx?: TxClient): TxClient {
    return tx ?? this.db;
  }

  // ─── TagsConfig ─────────────────────────────────────────────────────────────

  async getActiveConfigByKey(configKey: string, tx?: TxClient): Promise<TagsConfig | null> {
    return this.client(tx).tagsConfig.findFirst({
      where: { configKey, isDeleted: false },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listActiveConfigsBySource(sourceType: string, workspaceId: string, tx?: TxClient): Promise<TagsConfig[]> {
    return this.client(tx).tagsConfig.findMany({
      where: { sourceType, workspaceId, isDeleted: false },
      orderBy: { createdAt: 'desc' },
    });
  }

  async insertConfigRow(data: InsertConfigRowData, tx?: TxClient): Promise<TagsConfig> {
    const now = new Date();
    return this.client(tx).tagsConfig.create({
      data: {
        configKey: data.configKey,
        sourceType: data.sourceType,
        workspaceId: data.workspaceId,
        config: data.config,
        createdBy: data.createdBy ?? null,
        updatedBy: data.updatedBy ?? null,
        createdAt: now,
        updatedAt: now,
        isDeleted: false,
      },
    });
  }

  async softDeleteConfigRow(id: string, updatedBy?: string | null, tx?: TxClient): Promise<void> {
    await this.client(tx).tagsConfig.update({
      where: { id },
      data: { isDeleted: true, updatedAt: new Date(), ...(updatedBy !== undefined ? { updatedBy } : {}) },
    });
  }

  // ─── Tag ────────────────────────────────────────────────────────────────────

  async findActiveTag(
    sourceId: string,
    sourceType: string,
    tagCategory: string,
    tag: string,
    tx?: TxClient,
  ): Promise<Tag | null> {
    return this.client(tx).tag.findFirst({
      where: { sourceId, sourceType, tagCategory, tag, isDeleted: false },
    });
  }

  async findActiveTags(
    sourceId: string,
    sourceType: string,
    tagCategory?: string,
    tx?: TxClient,
  ): Promise<Tag[]> {
    return this.client(tx).tag.findMany({
      where: {
        sourceId,
        sourceType,
        isDeleted: false,
        ...(tagCategory !== undefined ? { tagCategory } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Bulk-resolve Tag ids to their `{ id, tag }` rows, scoped to a workspace.
   * Used to resolve id-referencing arrays (e.g. Call.labels) back to display
   * text without exposing raw Tag ids in the UI.
   */
  async findByIds(ids: string[], workspaceId: string, tx?: TxClient): Promise<Tag[]> {
    if (ids.length === 0) return [];
    return this.client(tx).tag.findMany({
      where: { id: { in: ids }, workspaceId, isDeleted: false },
    });
  }

  async distinctTagsByCategory(
    workspaceId: string,
    sourceType: string,
    tagCategory: string,
  ): Promise<string[]> {
    const rows = await this.client().tag.findMany({
      where: { workspaceId, sourceType, tagCategory, isDeleted: false },
      distinct: ['tag'],
      select: { tag: true },
      orderBy: { tag: 'asc' },
      take: 50,
    });
    return rows.map(r => r.tag);
  }

  async insertTagRow(data: InsertTagRowData, tx?: TxClient): Promise<Tag> {
    const now = new Date();
    return this.client(tx).tag.create({
      data: {
        sourceId: data.sourceId,
        sourceType: data.sourceType,
        workspaceId: data.workspaceId,
        configKey: data.configKey ?? null,
        tagCategory: data.tagCategory,
        tag: data.tag,
        method: data.method,
        reason: data.reason ?? null,
        createdBy: data.createdBy ?? null,
        updatedBy: data.updatedBy ?? null,
        createdAt: now,
        updatedAt: now,
        isDeleted: false,
      },
    });
  }

  async softDeleteTagRow(id: string, updatedBy?: string | null, tx?: TxClient): Promise<void> {
    await this.client(tx).tag.update({
      where: { id },
      data: { isDeleted: true, updatedAt: new Date(), ...(updatedBy !== undefined ? { updatedBy } : {}) },
    });
  }

  async findById(id: string, workspaceId: string, tx?: TxClient): Promise<Tag | null> {
    return this.client(tx).tag.findFirst({
      where: { id, workspaceId, isDeleted: false },
    });
  }

  async updateTagMethod(id: string, method: TagMethod, updatedBy?: string | null, tx?: TxClient): Promise<Tag> {
    return this.client(tx).tag.update({
      where: { id },
      data: { method, updatedAt: new Date(), ...(updatedBy !== undefined ? { updatedBy } : {}) },
    });
  }

  /**
   * Returns all distinct (tagCategory, tag) pairs for a configKey (capped at 500).
   * Used by the "AI Tags" filter submenu to list all tags that actually exist for a channel.
   */
  async findDistinctTagsByConfigKey(
    configKey: string,
  ): Promise<{ tagCategory: string; tag: string }[]> {
    return this.client().tag.findMany({
      where: { configKey, sourceType: 'desk-email', isDeleted: false },
      distinct: ['tagCategory', 'tag'],
      select: { tagCategory: true, tag: true },
      orderBy: [{ tagCategory: 'asc' }, { tag: 'asc' }],
      take: 500,
    });
  }

  /**
   * Delta-sync all tags for a projection source (e.g. 'desk-ticket') against
   * the given rows in one transaction step.
   *
   * Semantics:
   *   - Rows present in both existing and incoming → untouched.
   *   - Rows only in existing → HARD-DELETED (not soft-deleted).
   *   - Rows only in incoming → inserted.
   *   - Empty `rows` → all existing rows hard-deleted.
   *
   * Hard delete is intentional: ticket tag rows are a derived projection of
   * the canonical desk-email tag rows. Audit history lives on the email side
   * (isDeleted rows there). Do NOT reuse this hard-delete policy for
   * source-of-truth entities like 'desk-email' — that would cause data loss.
   *
   * Equality is checked by (tagCategory, tag, method) — reason is excluded to
   * avoid constant rewrites when LLM reasons change on every regen.
   * Incoming rows are deduped by the same key before diffing.
   *
   * Must be called inside an existing transaction (tx is required).
   * Returns true if anything actually changed.
   */
  async replaceAllTagsForSource(
    params: {
      sourceId: string;
      sourceType: string;
      workspaceId: string;
      configKey: string;
      rows: MirrorTagRow[];
    },
    tx: TxClient,
  ): Promise<boolean> {
    const { sourceId, sourceType, workspaceId, configKey, rows } = params;

    const existing = await tx.tag.findMany({
      where: { sourceId, sourceType, isDeleted: false },
      select: { id: true, tagCategory: true, tag: true, method: true },
    });

    const toKey = (r: { tagCategory: string; tag: string; method: string }) =>
      `${r.tagCategory}|${r.tag}|${r.method}`;

    const existingByKey = new Map(existing.map(r => [toKey(r), r.id]));
    const incomingKeySet = new Set(rows.map(toKey));

    const isEqual =
      existingByKey.size === incomingKeySet.size &&
      [...incomingKeySet].every(k => existingByKey.has(k));

    if (isEqual) return false;

    const toDeleteIds = existing
      .filter(r => !incomingKeySet.has(toKey(r)))
      .map(r => r.id);

    const toInsert = [...new Map(rows.map(r => [toKey(r), r])).values()]
      .filter(r => !existingByKey.has(toKey(r)));

    const now = new Date();

    if (toDeleteIds.length > 0) {
      await tx.tag.deleteMany({ where: { id: { in: toDeleteIds } } });
    }

    if (toInsert.length > 0) {
      await tx.tag.createMany({
        data: toInsert.map(row => ({
          sourceId,
          sourceType,
          workspaceId,
          configKey,
          tagCategory: row.tagCategory,
          tag: row.tag,
          method: row.method as TagMethod,
          reason: row.reason ?? null,
          createdAt: now,
          updatedAt: now,
          isDeleted: false,
        })),
      });
    }

    return true;
  }

 
  /**
   * Returns conversationIds of tickets where any email in the conversation carries
   * any of the given "category:tag" values (OR semantics).
   */
  async findConversationIdsByEmailTags(
    channelId: string,
    generatedTags: string[],
  ): Promise<string[]> {
    if (generatedTags.length === 0) return [];

    logger.info('[TAG-REPO] findConversationIdsByEmailTags entered', { channelId, generatedTags });

    const pairs = generatedTags
      .map(t => t.split(':'))
      .filter(parts => parts.length >= 2)
      .map(([category, ...rest]) => ({ category, tag: rest.join(':') }));

    if (pairs.length === 0) return [];

    const conditions = pairs.map(
      ({ category, tag }) => Prisma.sql`(t."tagCategory" = ${category} AND t.tag = ${tag})`,
    );
    const whereClause = Prisma.join(conditions, ' OR ');

    const rows = await this.db.$queryRaw<{ conversationId: string }[]>`
      SELECT e."conversationId", MAX(e."createdAt") AS latest
      FROM public.emails e
      WHERE e."channelId" = ${channelId}
        AND EXISTS (
          SELECT 1 FROM non_zero.tags t
          WHERE t."sourceId" = e.id
            AND t."sourceType" = 'desk-email'
            AND t."isDeleted" = false
            AND (${whereClause})
        )
      GROUP BY e."conversationId"
      ORDER BY latest DESC
      LIMIT 1000
    `;

    logger.info('[TAG-REPO] findConversationIdsByEmailTags success', { channelId, count: rows.length });

    return rows.map(r => r.conversationId);
  }

  /**
   * Distinct (conversationId, tagCategory, tag) triples for every email of a desk
   * channel created inside [start, end].
   *
   * Where `findConversationIdsByEmailTags` answers "which threads match this
   * filter?", this is the grouping read: the caller gets the tag values themselves
   * so it can bucket tickets by category.
   */
  async findGeneratedTagsByConversation(
    channelId: string,
    configKey: string,
    start: Date,
    end: Date,
  ): Promise<{ conversationId: string; tagCategory: string; tag: string }[]> {
    // Last email per conversation: a thread is re-tagged per email, so reading
    // them all put one ticket in several sentiment groups at once.
    const emails = await this.client().email.findMany({
      where: { channelId, createdAt: { gte: start, lte: end } },
      orderBy: [{ conversationId: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }],
      distinct: ['conversationId'],
      select: { id: true, conversationId: true },
    });
    if (emails.length === 0) return [];

    // Tags hang off the email (`sourceId`), and `non_zero.tags` has no relation
    // to `public.emails` to traverse, so the conversation is joined back here.
    const conversationByEmailId = new Map(emails.map(e => [e.id, e.conversationId]));

    const tags = await this.client().tag.findMany({
      where: {
        sourceId: { in: [...conversationByEmailId.keys()] },
        sourceType: 'desk-email',
        configKey,
        isDeleted: false,
      },
      select: { sourceId: true, tagCategory: true, tag: true },
    });

    // Dedupe: the same category and tag can be stored twice against one email.
    // The key is
    // NUL-joined because categories and tags are LLM-authored free text: any
    // printable separator can occur inside them and would fold two distinct
    // triples into one ("customer intent"/"billing" vs "customer"/"intent billing").
    const seen = new Set<string>();
    const rows: { conversationId: string; tagCategory: string; tag: string }[] = [];
    for (const { sourceId, tagCategory, tag } of tags) {
      const conversationId = conversationByEmailId.get(sourceId);
      if (!conversationId) continue;
      const key = `${conversationId}\u0000${tagCategory}\u0000${tag}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ conversationId, tagCategory, tag });
    }

    logger.info('[TAG-REPO] findGeneratedTagsByConversation success', {
      channelId,
      count: rows.length,
    });

    return rows;
  }
}

export const tagRepository = new TagRepository();
