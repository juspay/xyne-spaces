import { TAG_FORMAT_REGEX } from '../schema.js';
import type { CategoryConfig, GeneratedTag } from '../types.js';

export function validateGeneratedTags(
  raw: GeneratedTag[],
  categories: Record<string, CategoryConfig>,
): GeneratedTag[] {
  const seen = new Set<string>();
  const byCategory = new Map<string, GeneratedTag[]>();

  for (const entry of raw) {
    const category = entry.category.trim().toLowerCase();
    const tag = entry.tag.trim().toLowerCase();

    if (!TAG_FORMAT_REGEX.test(category) || !TAG_FORMAT_REGEX.test(tag)) {
      continue;
    }

    const categoryConfig = categories[category];
    if (!categoryConfig) {
      continue;
    }

    if (categoryConfig.blacklist?.includes(tag)) {
      continue;
    }

    if (!categoryConfig.is_new_tag_allowed && !(categoryConfig.tags ?? []).includes(tag)) {
      continue;
    }

    const key = `${category}::${tag}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const reason = typeof entry.reason === 'string' && entry.reason.length > 0 ? entry.reason : undefined;
    const group = byCategory.get(category) ?? [];
    group.push({ category, tag, reason });
    byCategory.set(category, group);
  }

  const result: GeneratedTag[] = [];
  for (const [category, tagsForCategory] of byCategory) {
    const maxTags = categories[category]?.count;
    result.push(...(maxTags !== undefined ? tagsForCategory.slice(0, maxTags) : tagsForCategory));
  }

  return result;
}
