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
};
