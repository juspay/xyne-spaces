import { Prisma, Tag, TagsConfig } from '@prisma/client';
import { tagRepository } from '@/database/repositories/tagRepository';
import { TAG_FORMAT_REGEX, TagMethod } from '@xyne/shared';
import { TagsConfigShapeSchema } from './schema';
import { DESK_EMAIL_SOURCE_TYPE, DEFAULT_DESK_EMAIL_CONFIG } from './deskEmail';
import { syncTicketTagsFromEmail } from './deskTicket';
import type { CategoryCatalogEntry, CategoryConfig, GeneratedTag, PersistedTag, TagsConfigShape } from './types';

export class TagServiceError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'TagServiceError';
  }
}

const TAG_METHOD_MAP: Record<string, TagMethod> = {
  llm: TagMethod.LLM,
  manual: TagMethod.MANUAL,
};

export class TagService {
  // ─── TagsConfig CRUD ─────────────────────────────────────────────────────────

  async createConfig(
    configKey: string,
    sourceType: string,
    workspaceId: string,
    config: TagsConfigShape,
    createdBy?: string | null,
  ): Promise<TagsConfig> {
    const existing = await tagRepository.getActiveConfigByKey(configKey);
    if (existing) {
      throw new TagServiceError(`Active config already exists for configKey "${configKey}"`, 409);
    }

    return tagRepository.insertConfigRow({
      configKey,
      sourceType,
      workspaceId,
      config: config as unknown as Prisma.InputJsonValue,
      createdBy,
      updatedBy: createdBy,
    });
  }

  async updateConfig(
    configKey: string,
    newConfig: TagsConfigShape,
    updatedBy?: string | null,
  ): Promise<TagsConfig> {
    return tagRepository.getDb().$transaction(async (tx) => {
      const existing = await tagRepository.getActiveConfigByKey(configKey, tx);
      if (!existing) {
        throw new TagServiceError(`No active config found for configKey "${configKey}"`, 404);
      }

      await tagRepository.softDeleteConfigRow(existing.id, updatedBy, tx);

      return tagRepository.insertConfigRow({
        configKey,
        sourceType: existing.sourceType,
        workspaceId: existing.workspaceId,
        config: newConfig as unknown as Prisma.InputJsonValue,
        createdBy: existing.createdBy,
        updatedBy,
      }, tx);
    });
  }

  async upsertConfig(
    configKey: string,
    sourceType: string,
    workspaceId: string,
    newConfig: TagsConfigShape,
    updatedBy?: string | null,
  ): Promise<TagsConfig> {
    return tagRepository.getDb().$transaction(async (tx) => {
      const existing = await tagRepository.getActiveConfigByKey(configKey, tx);

      if (existing) {
        await tagRepository.softDeleteConfigRow(existing.id, updatedBy, tx);
      }

      return tagRepository.insertConfigRow({
        configKey,
        sourceType: existing?.sourceType ?? sourceType,
        workspaceId: existing?.workspaceId ?? workspaceId,
        config: newConfig as unknown as Prisma.InputJsonValue,
        createdBy: existing?.createdBy ?? updatedBy,
        updatedBy,
      }, tx);
    });
  }

  async deleteConfig(configKey: string, deletedBy?: string | null): Promise<void> {
    const existing = await tagRepository.getActiveConfigByKey(configKey);
    if (!existing) {
      throw new TagServiceError(`No active config found for configKey "${configKey}"`, 404);
    }

    await tagRepository.softDeleteConfigRow(existing.id, deletedBy);
  }

  async getConfig(configKey: string): Promise<TagsConfig | null> {
    return tagRepository.getActiveConfigByKey(configKey);
  }

  async listConfigsBySource(sourceType: string, workspaceId: string): Promise<TagsConfig[]> {
    return tagRepository.listActiveConfigsBySource(sourceType, workspaceId);
  }

  /**
   * Aggregates category definitions across all active configs for a source type
   * within a workspace, deduped by category name — the most recently updated
   * config's definition wins. Used to power cross-channel category-name
   * autocomplete + auto-fill.
   */
  async getCategoriesCatalog(sourceType: string, workspaceId: string): Promise<CategoryCatalogEntry[]> {
    const configs = await tagRepository.listActiveConfigsBySource(sourceType, workspaceId);

    const byName = new Map<string, CategoryCatalogEntry>();

    // Persisted configs take priority since its custom definition from user.
    for (const row of configs) {
      const shape = row.config as unknown as TagsConfigShape;
      for (const [name, category] of Object.entries(shape.categories ?? {})) {
        if (byName.has(name)) continue;
        byName.set(name, { name, ...category });
      }
    }

    // Seed defaults only for categories not already covered by a persisted config.
    if (sourceType === DESK_EMAIL_SOURCE_TYPE) {
      for (const [name, category] of Object.entries(DEFAULT_DESK_EMAIL_CONFIG.categories)) {
        if (byName.has(name)) continue;
        byName.set(name, { name, ...category });
      }
    }

    return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  // ─── Tag CRUD ────────────────────────────────────────────────────────────────

  async createTag(
    sourceId: string,
    sourceType: string,
    workspaceId: string,
    tagCategory: string,
    tag: string,
    method: TagMethod,
    createdBy?: string | null,
    override?: boolean,
    configKey?: string | null,
  ): Promise<Tag> {
    this.assertTagNameFormat(tagCategory, 'Tag category');
    this.assertTagNameFormat(tag, 'Tag');
    await this.assertManualCategoryOrOverride(configKey, tagCategory, override);

    const existing = await tagRepository.findActiveTag(sourceId, sourceType, tagCategory, tag);
    if (existing) {
      throw new TagServiceError(
        `Active tag "${tag}" already exists for ${sourceType}/${sourceId} in category "${tagCategory}"`,
        409,
      );
    }

    const created = await tagRepository.insertTagRow({
      sourceId,
      sourceType,
      workspaceId,
      configKey,
      tagCategory,
      tag,
      method,
      createdBy,
      updatedBy: createdBy,
    });

    if (sourceType === DESK_EMAIL_SOURCE_TYPE) await syncTicketTagsFromEmail(sourceId);

    return created;
  }

  async updateTag(
    sourceId: string,
    sourceType: string,
    tagCategory: string,
    oldTag: string,
    newTag: string,
    updatedBy?: string | null,
    override?: boolean,
    configKey?: string | null,
  ): Promise<Tag> {
    this.assertTagNameFormat(tagCategory, 'Tag category');
    this.assertTagNameFormat(oldTag, 'Tag');
    this.assertTagNameFormat(newTag, 'Tag');

    const updated = await tagRepository.getDb().$transaction(async (tx) => {
      const existing = await tagRepository.findActiveTag(sourceId, sourceType, tagCategory, oldTag, tx);
      if (!existing) {
        throw new TagServiceError(
          `No active tag "${oldTag}" found for ${sourceType}/${sourceId} in category "${tagCategory}"`,
          404,
        );
      }

      await this.assertManualCategoryOrOverride(configKey, tagCategory, override);

      await tagRepository.softDeleteTagRow(existing.id, updatedBy, tx);

      return tagRepository.insertTagRow({
        sourceId,
        sourceType,
        workspaceId: existing.workspaceId,
        configKey: existing.configKey,
        tagCategory,
        tag: newTag,
        method: existing.method as TagMethod,
        createdBy: existing.createdBy,
        updatedBy,
      }, tx);
    });

    if (sourceType === DESK_EMAIL_SOURCE_TYPE) await syncTicketTagsFromEmail(sourceId);

    return updated;
  }

  async deleteTag(
    sourceId: string,
    sourceType: string,
    tagCategory: string,
    tag: string,
    deletedBy?: string | null,
    override?: boolean,
    configKey?: string | null,
  ): Promise<void> {
    this.assertTagNameFormat(tagCategory, 'Tag category');
    this.assertTagNameFormat(tag, 'Tag');

    const existing = await tagRepository.findActiveTag(sourceId, sourceType, tagCategory, tag);
    if (!existing) {
      throw new TagServiceError(
        `No active tag "${tag}" found for ${sourceType}/${sourceId} in category "${tagCategory}"`,
        404,
      );
    }

    await this.assertManualCategoryOrOverride(configKey, tagCategory, override);

    await tagRepository.softDeleteTagRow(existing.id, deletedBy);

    if (sourceType === DESK_EMAIL_SOURCE_TYPE) await syncTicketTagsFromEmail(sourceId);
  }

  /**
   * Flip an existing (AI-suggested) Tag row's method to `manual` in place —
   * same id, so any array of Tag ids referencing it (e.g. Call.labels) needs
   * no update. Used to "confirm" an AI-suggested tag from a tick/cross UI.
   * Idempotent: confirming an already-manual tag is a no-op.
   */
  async confirmTag(tagId: string, workspaceId: string, updatedBy?: string | null): Promise<Tag> {
    const existing = await tagRepository.findById(tagId, workspaceId);
    if (!existing) {
      throw new TagServiceError(`No active tag found for id "${tagId}"`, 404);
    }
    if (existing.method === TagMethod.MANUAL) return existing;

    const confirmed = await tagRepository.updateTagMethod(tagId, TagMethod.MANUAL, updatedBy);

    if (existing.sourceType === DESK_EMAIL_SOURCE_TYPE) await syncTicketTagsFromEmail(existing.sourceId);

    return confirmed;
  }

  async getUniqueTagValues(
    workspaceId: string,
    sourceType: string,
    tagCategory: string,
  ): Promise<string[]> {
    this.assertTagNameFormat(tagCategory, 'Tag category');
    return tagRepository.distinctTagsByCategory(workspaceId, sourceType, tagCategory);
  }

  async listTags(sourceId: string, sourceType: string, tagCategory?: string): Promise<Tag[]> {
    if (tagCategory !== undefined) {
      this.assertTagNameFormat(tagCategory, 'Tag category');
    }
    return tagRepository.findActiveTags(sourceId, sourceType, tagCategory);
  }

  /** Bulk-resolve Tag ids to their display values, scoped to a workspace. */
  async getTagsByIds(ids: string[], workspaceId: string): Promise<Tag[]> {
    return tagRepository.findByIds(ids, workspaceId);
  }

  // ─── Bulk operations used by the framework & manual-tagging UI ───────────────

  async setManualTags(
    sourceId: string,
    sourceType: string,
    workspaceId: string,
    tagCategory: string,
    tags: string[],
    userId: string,
    override?: boolean,
    configKey?: string | null,
  ): Promise<PersistedTag[]> {
    this.assertTagNameFormat(tagCategory, 'Tag category');
    for (const tag of tags) {
      this.assertTagNameFormat(tag, 'Tag');
    }
    await this.assertManualCategoryOrOverride(configKey, tagCategory, override);

    const result = await tagRepository.getDb().$transaction(async (tx) => {
      const current = await tagRepository.findActiveTags(sourceId, sourceType, tagCategory, tx);
      const currentTagValues = new Set(current.map((row) => row.tag));
      const desiredTagValues = new Set(tags);

      const toAdd = tags.filter((tag) => !currentTagValues.has(tag));
      const toRemove = current.filter((row) => !desiredTagValues.has(row.tag));

      for (const row of toRemove) {
        await tagRepository.softDeleteTagRow(row.id, userId, tx);
      }

      for (const tag of toAdd) {
        await tagRepository.insertTagRow({
          sourceId,
          sourceType,
          workspaceId,
          configKey,
          tagCategory,
          tag,
          method: TagMethod.MANUAL,
          createdBy: userId,
          updatedBy: userId,
        }, tx);
      }

      const updated = await tagRepository.findActiveTags(sourceId, sourceType, tagCategory, tx);
      return updated.map((row) => ({ tagCategory: row.tagCategory, tag: row.tag, method: row.method as TagMethod }));
    });

    if (sourceType === DESK_EMAIL_SOURCE_TYPE) await syncTicketTagsFromEmail(sourceId);

    return result;
  }

  async replaceTagsForCategories(
    sourceId: string,
    sourceType: string,
    workspaceId: string,
    categories: Record<string, CategoryConfig>,
    generated: GeneratedTag[],
    configKey?: string | null,
  ): Promise<PersistedTag[]> {
    const generatedByCategory = new Map<string, GeneratedTag[]>();
    for (const item of generated) {
      const list = generatedByCategory.get(item.category) ?? [];
      list.push(item);
      generatedByCategory.set(item.category, list);
    }

    const persisted = await tagRepository.getDb().$transaction(async (tx) => {
      const result: PersistedTag[] = [];

      for (const [category, categoryConfig] of Object.entries(categories)) {
        if (categoryConfig.method === 'manual') continue;
        this.assertTagNameFormat(category, 'Tag category');

        const method = TAG_METHOD_MAP[categoryConfig.method];
        if (!method) continue;

        const existing = await tagRepository.findActiveTags(sourceId, sourceType, category, tx);
        for (const row of existing) {
          await tagRepository.softDeleteTagRow(row.id, undefined, tx);
        }

        const tagsForCategory = generatedByCategory.get(category) ?? [];
        for (const item of tagsForCategory) {
          const reason = item.reason ?? null;
          await tagRepository.insertTagRow({
            sourceId,
            sourceType,
            workspaceId,
            configKey,
            tagCategory: category,
            tag: item.tag,
            method,
            reason,
          }, tx);
          result.push({ tagCategory: category, tag: item.tag, method, reason });
        }
      }

      return result;
    });

    if (sourceType === DESK_EMAIL_SOURCE_TYPE) await syncTicketTagsFromEmail(sourceId);

    return persisted;
  }

  private assertTagNameFormat(value: string, label: 'Tag' | 'Tag category'): void {
    if (!TAG_FORMAT_REGEX.test(value)) {
      throw new TagServiceError(
        `${label} "${value}" does not match required format (lowercase, hyphen-separated, alphanumeric segments)`,
        400,
      );
    }
  }

  private async assertManualCategoryOrOverride(
    configKey: string | null | undefined,
    tagCategory: string,
    override?: boolean,
  ): Promise<void> {
    this.assertTagNameFormat(tagCategory, 'Tag category');

    if (!configKey) return;

    const configRow = await tagRepository.getActiveConfigByKey(configKey);
    if (!configRow) return;

    const parsedConfig = TagsConfigShapeSchema.safeParse(configRow.config);
    if (!parsedConfig.success) {
      throw new Error(`Invalid active tag config for configKey "${configKey}"`);
    }

    const categoryConfig = parsedConfig.data.categories[tagCategory];
    if (!categoryConfig) {
      throw new TagServiceError(
        `Tag category "${tagCategory}" is not configured. Add it to the active tag config first.`,
        400,
      );
    }

    if (categoryConfig?.method === 'manual') return;
    if (override === true) return;

    throw new TagServiceError(
      `Tag category "${tagCategory}" is not manual. Pass override=true to modify it manually.`,
      400,
    );
  }
}

export const tagService = new TagService();
