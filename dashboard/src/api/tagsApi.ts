import { apiInstance } from '../services/clients/apiClient';

export interface TagGroupConfigOptions {
  method: string;
  allowedTags: string[];
  maxCount?: number;
  isNewTagAllowed?: boolean;
}

export interface TagGroup {
  category: string;
  color?: string;
  tags: { tag: string; reason?: string | null }[];
  configOptions?: TagGroupConfigOptions;
}

export const tagsApi = {
  getTicketLatestEmailTags: async (ticketId: string): Promise<TagGroup[]> => {
    const res = await apiInstance.get<{ groups: TagGroup[] }>(
      `/tickets/${ticketId}/latest-email-tags`,
    );
    return res.data.groups;
  },

  getUniqueTagValues: async (categoryName: string, sourceType: string): Promise<string[]> => {
    const res = await apiInstance.get<{ values: string[] }>('/tags/unique-values', {
      params: { categoryName, sourceType },
    });
    return res.data.values;
  },

  // ─── Generic entity endpoints ──────────────────────────────────────────────
  getEntityTags: async (sourceType: string, sourceId: string): Promise<TagGroup[]> => {
    const res = await apiInstance.get<{ groups: TagGroup[] }>(
      `/tags/entity/${sourceType}/${sourceId}`,
    );
    return res.data.groups;
  },

  addEntityTag: async (
    sourceType: string,
    sourceId: string,
    category: string,
    tag: string,
  ): Promise<void> => {
    await apiInstance.post(`/tags/entity/${sourceType}/${sourceId}`, { category, tag });
  },

  removeEntityTag: async (
    sourceType: string,
    sourceId: string,
    category: string,
    tag: string,
  ): Promise<void> => {
    await apiInstance.delete(`/tags/entity/${sourceType}/${sourceId}`, { data: { category, tag } });
  },
};
