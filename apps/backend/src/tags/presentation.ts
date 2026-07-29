import { tagService } from './service';
import { DESK_EMAIL_SOURCE_TYPE, DEFAULT_DESK_EMAIL_CONFIG } from './deskEmail';
import type { TagsConfigShape } from './types';

export interface TagGroup {
  category: string;
  color?: string;
  tags: { tag: string; reason?: string | null }[];
}

export interface TagGroupConfigOptions {
  method: string;
  allowedTags: string[];
  maxCount?: number;
  isNewTagAllowed?: boolean;
}

export interface TagGroupWithConfig extends TagGroup {
  configOptions?: TagGroupConfigOptions;
}

/**
 * Grouped tags with category config — used for tag editor and read-only displays.
 * Returns ALL configured categories (even with 0 current tags) so the user
 * can add tags to any category, and includes configOptions for validation.
 */
export async function getGroupedTagsWithConfig(
  sourceId: string,
  sourceType: string,
  configKey: string,
): Promise<TagGroupWithConfig[]> {
  const [tags, configRow] = await Promise.all([
    tagService.listTags(sourceId, sourceType),
    tagService.getConfig(configKey),
  ]);

  const parsedCategories = (configRow?.config as unknown as TagsConfigShape | undefined)?.categories;
  const categories =
    parsedCategories ??
    (sourceType === DESK_EMAIL_SOURCE_TYPE ? DEFAULT_DESK_EMAIL_CONFIG.categories : {});

  const byCategory = new Map<string, TagGroupWithConfig>();

  // Seed every configured category (including those with 0 current tags)
  for (const [catName, catConfig] of Object.entries(categories)) {
    byCategory.set(catName, {
      category: catName,
      color: catConfig.color,
      tags: [],
      configOptions: {
        method: catConfig.method,
        allowedTags: catConfig.tags ?? [],
        maxCount: catConfig.count,
        isNewTagAllowed: catConfig.is_new_tag_allowed,
      },
    });
  }

  // Attach active tags (may include categories not in current config)
  for (const t of tags) {
    let group = byCategory.get(t.tagCategory);
    if (!group) {
      group = { category: t.tagCategory, tags: [] };
      byCategory.set(t.tagCategory, group);
    }
    group.tags.push({ tag: t.tag, reason: t.reason });
  }

  // Categories with current tags first, then alphabetical
  return Array.from(byCategory.values()).sort((a, b) => {
    if (a.tags.length > 0 && b.tags.length === 0) return -1;
    if (a.tags.length === 0 && b.tags.length > 0) return 1;
    return a.category.localeCompare(b.category);
  });
}
