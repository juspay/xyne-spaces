import {
  buildVespaSearchParams,
  normalizeVespaSearchResponseData,
  sanitizeSearchQuery,
} from '@/src/utils/search';
import type {
  VespaSearchFilters,
  VespaSearchResponse,
  VespaSearchResultsPage,
} from '@/src/types/search';
import { apiGet } from './apiClient';

export class GlobalSearchService {
  private vespaBasePath = '/vespaSearch';
  private defaultApps = 'chat,ticket,file';

  async search(filters: VespaSearchFilters): Promise<VespaSearchResultsPage> {
    try {
      const sanitizedFilters: VespaSearchFilters = {
        ...filters,
        query: sanitizeSearchQuery(filters.query),
        apps: filters.apps ?? this.defaultApps,
      };

      const params = buildVespaSearchParams(sanitizedFilters);
      const queryString = new URLSearchParams(params).toString();
      const path =
        queryString.length > 0 ? `${this.vespaBasePath}?${queryString}` : this.vespaBasePath;

      const response = await apiGet<VespaSearchResponse>(path);

      if (!response.success || !response.data) {
        throw new Error(response.error || 'Global search request failed');
      }

      return normalizeVespaSearchResponseData(response.data);
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }

      throw new Error('Global search request failed');
    }
  }
}

export const globalSearchService = new GlobalSearchService();
