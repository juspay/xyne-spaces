import { apiGet } from '@/src/services/apiClient';

import type { ChannelGeneratedTagItem } from '../utils/map-generated-tags-to-filter-options';

export type { ChannelGeneratedTagItem } from '../utils/map-generated-tags-to-filter-options';
export {
  mapGeneratedTagsToFilterOptions,
  type GeneratedTagFilterOption,
} from '../utils/map-generated-tags-to-filter-options';

/**
 * Desk AI / generated-tags REST (dashboard `tagsConfigApi`).
 * Tags live in non_zero — Zero does not sync them; filter via conversationIds.
 *
 * Pinned public SHA exposes `all-generated-tags` + `conversations-by-tags` only.
 * There is no `generated-tag-categories` or `generated-tags/:category`.
 */
export const tagsConfigApi = {
  getAllGeneratedTags: async (channelId: string): Promise<ChannelGeneratedTagItem[]> => {
    const res = await apiGet<{ tags: ChannelGeneratedTagItem[] }>(
      `/channels/${channelId}/tags-config/all-generated-tags`,
    );
    return res.tags ?? [];
  },

  filterConversationsByTags: async (channelId: string, tags: string[]): Promise<string[]> => {
    const params = new URLSearchParams();
    for (const tag of tags) params.append('tags', tag);
    const res = await apiGet<{ conversationIds: string[] }>(
      `/channels/${channelId}/tags-config/conversations-by-tags?${params.toString()}`,
    );
    return res.conversationIds ?? [];
  },
};
