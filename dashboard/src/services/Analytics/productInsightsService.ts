import { apiInstance } from '../clients/apiClient';

// Enums for selectors
export const Scope = {
  INTERNAL: 'INTERNAL',
  EXTERNAL: 'EXTERNAL',
} as const;
export type Scope = (typeof Scope)[keyof typeof Scope];

export const TimeRange = {
  ALL: 'ALL',
  YESTERDAY: 'YESTERDAY',
  LAST_7_DAYS: 'LAST_7_DAYS',
  LAST_30_DAYS: 'LAST_30_DAYS',
} as const;
export type TimeRange = (typeof TimeRange)[keyof typeof TimeRange];

export interface Ticket {
  docId: string;
  title: string;
  description: string;
  clusterId?: string;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export interface Cluster {
  theme_title: string;
  theme_description: string;
  outlier_tickets: Ticket[];
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export interface MetaTheme {
  meta_theme: string;
  description: string;
  impacted_clusters: string[];
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export interface ProductInsightsData {
  cluster_themes: Record<string, Cluster>;
  meta_themes: MetaTheme[];
  cluster_details: Record<string, Ticket[]>;
}

export interface ProductInsightsParams {
  scope: Scope;
  timeRange: TimeRange;
}

class ProductInsightsService {
  /**
   * Fetch product insights from the backend API
   */
  async getProductInsights(params: ProductInsightsParams): Promise<ProductInsightsData> {
    const response = await apiInstance.get<{ data: ProductInsightsData }>('/productInsights', {
      params: {
        scope: params.scope,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        time_range: params.timeRange,
      },
    });

    return response.data.data;
  }
}

export const productInsightsService = new ProductInsightsService();
