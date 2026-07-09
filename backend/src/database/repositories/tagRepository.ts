import { DatabaseClient } from '../client';
import { Prisma, Tag, TagMethod, TagsConfig } from '@prisma/client';

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
}

export const tagRepository = new TagRepository();
