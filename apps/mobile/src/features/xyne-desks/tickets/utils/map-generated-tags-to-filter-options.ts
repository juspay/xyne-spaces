/** Catalog row from GET /channels/:channelId/tags-config/all-generated-tags. */
export type ChannelGeneratedTagItem = {
  category: string;
  tag: string;
};

export type GeneratedTagFilterOption = {
  id: string;
  label: string;
  subtitle: string;
};

/**
 * Map catalog `{ category, tag }` rows to filter options.
 * Ids are `category:tag` — same contract as conversations-by-tags / dashboard.
 */
export function mapGeneratedTagsToFilterOptions(
  tags: readonly ChannelGeneratedTagItem[],
): GeneratedTagFilterOption[] {
  const options: GeneratedTagFilterOption[] = [];
  for (const item of tags) {
    const category = item.category?.trim();
    const tag = item.tag?.trim();
    if (!category || !tag) continue;
    options.push({
      id: `${category}:${tag}`,
      label: tag,
      subtitle: category,
    });
  }
  return options;
}
