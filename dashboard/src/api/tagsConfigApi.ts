import { apiInstance } from '../services/clients/apiClient';

export interface TagCategoryConfig {
  method: 'manual' | 'llm';
  color?: string;
  count?: number;
  tags?: string[];
  is_new_tag_allowed?: boolean;
  blacklist?: string[];
  prompt?: string;
}

export type TagCategories = Record<string, TagCategoryConfig>;

export type CategoryCatalogEntry = TagCategoryConfig & { name: string };

export interface GeneratedTagPreviewItem {
  category: string;
  tag: string;
  reason?: string | null;
}

export interface ChannelGeneratedTagItem {
  category: string;
  tag: string;
}

export const tagsConfigApi = {
  getConfig: async (channelId: string): Promise<TagCategories> => {
    const res = await apiInstance.get<{ categories: TagCategories }>(
      `/channels/${channelId}/tags-config`,
    );
    return res.data.categories;
  },

  updateConfig: async (channelId: string, categories: TagCategories): Promise<TagCategories> => {
    const res = await apiInstance.patch<{ categories: TagCategories }>(
      `/channels/${channelId}/tags-config`,
      { categories },
    );
    return res.data.categories;
  },

  getCategoriesCatalog: async (sourceType: string): Promise<CategoryCatalogEntry[]> => {
    const res = await apiInstance.get<{ catalog: CategoryCatalogEntry[] }>(
      '/tags/configs/categories-catalog',
      { params: { sourceType } },
    );
    return res.data.catalog;
  },

  previewTagGeneration: async (
    channelId: string,
    subject: string,
    body: string,
  ): Promise<GeneratedTagPreviewItem[]> => {
    const res = await apiInstance.post<{ tags: GeneratedTagPreviewItem[] }>(
      `/channels/${channelId}/tags-config/preview`,
      { subject, body },
    );
    return res.data.tags;
  },

  getAllGeneratedTags: async (channelId: string): Promise<ChannelGeneratedTagItem[]> => {
    const res = await apiInstance.get<{ tags: ChannelGeneratedTagItem[] }>(
      `/channels/${channelId}/tags-config/all-generated-tags`,
    );
    return res.data.tags;
  },

  filterConversationsByTags: async (channelId: string, tags: string[]): Promise<string[]> => {
    const res = await apiInstance.get<{ conversationIds: string[] }>(
      `/channels/${channelId}/tags-config/conversations-by-tags`,
      { params: { tags } },
    );
    return res.data.conversationIds;
  },
};
