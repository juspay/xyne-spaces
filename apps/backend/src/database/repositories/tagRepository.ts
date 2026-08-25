import { DatabaseClient } from '../client';
import { Prisma, Tag, TagsConfig } from '@prisma/client';
import { TagMethod } from '@xyne/shared';
import { logger } from '../../utils/logger';

export type TxClient = Prisma.TransactionClient;

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
   * so it can bucket tickets by category. `truncated` reports the `rowCap` being
   * hit, so the client can warn rather than silently under-report.
   */
  async findGeneratedTagsByConversation(
    channelId: string,
    configKey: string,
    start: Date,
    end: Date,
    rowCap = 50000,
  ): Promise<{ rows: { conversationId: string; tagCategory: string; tag: string }[]; truncated: boolean }> {
    // Fetch one extra row so a full page can be distinguished from an exact fit.
    const limit = rowCap + 1;

    const rows = await this.db.$queryRaw<{ conversationId: string; tagCategory: string; tag: string }[]>`
      SELECT DISTINCT
        e."conversationId" AS "conversationId",
        t."tagCategory"    AS "tagCategory",
        t.tag              AS "tag"
      FROM public.emails e
      JOIN non_zero.tags t
        ON t."sourceId" = e.id
       AND t."sourceType" = 'desk-email'
       AND t."configKey" = ${configKey}
       AND t."isDeleted" = false
      WHERE e."channelId" = ${channelId}
        AND e."createdAt" >= ${start}
        AND e."createdAt" <= ${end}
      -- Deterministic: without an ORDER BY, a truncated result is an arbitrary
      -- subset that can differ between refetches, so the groupings would shift.
      ORDER BY "conversationId", "tagCategory", "tag"
      LIMIT ${limit}
    `;

    const truncated = rows.length > rowCap;
    let complete = rows;
    if (truncated) {
      // Cutting at an arbitrary row hands back a conversation carrying only some
      // of its tags, which reads as real data. The ORDER BY groups each
      // conversation together, so dropping the trailing partial one leaves the
      // rest whole — unless it fills the cap, where that would leave nothing.
      const kept = rows.slice(0, rowCap);
      const last = kept[kept.length - 1]?.conversationId;
      const trimmed = kept.filter(row => row.conversationId !== last);
      complete = trimmed.length > 0 ? trimmed : kept;
    }

    logger.info('[TAG-REPO] findGeneratedTagsByConversation success', {
      channelId,
      count: complete.length,
      truncated,
    });

    return { rows: complete, truncated };
  }
}

export const tagRepository = new TagRepository();
