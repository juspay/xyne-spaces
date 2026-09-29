import { transaction } from '../base';
import type { PersistedTag } from '@/tags/types';
import { tagRepository } from '@/database/repositories/tagRepository';
import type { TagService } from '@/tags';
import { TAG_METHOD_MAP, TagServiceError } from '@/tags/service';
import { Prisma } from '@prisma/client';
import { TagMethod } from '@xyne/shared';


export function updateConfigTx(configKey: string, updatedBy: string | null | undefined, newConfig: { categories: Record<string, { method: "manual" | "llm"; color?: string | undefined; count?: number | undefined; tags?: string[] | undefined; is_new_tag_allowed?: boolean | undefined; blacklist?: string[] | undefined; prompt?: string | undefined; }>; }) {
  return transaction(['Tag', 'TagsConfig'], 'updateConfig: tag config soft-delete plus replacement insert must commit atomically; tx is not ACL-wrapped', tagRepository.getDb(), async (tx) => {
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
export function upsertConfigTx(configKey: string, updatedBy: string | null | undefined, sourceType: string, workspaceId: string, newConfig: { categories: Record<string, { method: "manual" | "llm"; color?: string | undefined; count?: number | undefined; tags?: string[] | undefined; is_new_tag_allowed?: boolean | undefined; blacklist?: string[] | undefined; prompt?: string | undefined; }>; }) {
  return transaction(['Tag', 'TagsConfig'], 'upsertConfig: tag config soft-delete plus replacement insert must commit atomically; tx is not ACL-wrapped', tagRepository.getDb(), async (tx) => {
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
export function updateTagTx(sourceId: string, sourceType: string, tagCategory: string, oldTag: string, self: TagService, configKey: string | null | undefined, override: boolean | undefined, updatedBy: string | null | undefined, newTag: string) {
  return transaction(['Tag', 'TagsConfig'], 'updateTag: tag row soft-delete plus renamed insert must commit atomically; tx is not ACL-wrapped', tagRepository.getDb(), async (tx) => {
    const existing = await tagRepository.findActiveTag(sourceId, sourceType, tagCategory, oldTag, tx);
    if (!existing) {
      throw new TagServiceError(
        `No active tag "${oldTag}" found for ${sourceType}/${sourceId} in category "${tagCategory}"`,
        404,
      );
    }

    await self.assertManualCategoryOrOverride(configKey, tagCategory, override);

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
}
export function setManualTagsTx(sourceId: string, sourceType: string, tagCategory: string, tags: string[], userId: string, workspaceId: string, configKey: string | null | undefined) {
  return transaction(['Tag', 'TagsConfig'], 'setManualTags: manual tag removals plus additions must commit atomically; tx is not ACL-wrapped', tagRepository.getDb(), async (tx) => {
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
}
export function replaceTagsForCategoriesTx(categories: Record<string, { method: "manual" | "llm"; color?: string | undefined; count?: number | undefined; tags?: string[] | undefined; is_new_tag_allowed?: boolean | undefined; blacklist?: string[] | undefined; prompt?: string | undefined; }>, self: TagService, sourceId: string, sourceType: string, generatedByCategory: Map<string, { category: string; tag: string; reason?: string | undefined; }[]>, workspaceId: string, configKey: string | null | undefined) {
  return transaction(['Tag', 'TagsConfig'], 'replaceTagsForCategories: generated tag replacement across categories must commit atomically; tx is not ACL-wrapped', tagRepository.getDb(), async (tx) => {
    const result: PersistedTag[] = [];

    for (const [category, categoryConfig] of Object.entries(categories)) {
      if (categoryConfig.method === 'manual') continue;
      self.assertTagNameFormat(category, 'Tag category');

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
}
