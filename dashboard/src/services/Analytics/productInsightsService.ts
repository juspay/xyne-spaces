import { apiInstance } from '../clients/apiClient';

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
  projectId: string;
}

class ProductInsightsService {
  /**
   * Fetch product insights from the backend API
   */
  async getProductInsights(params: ProductInsightsParams): Promise<ProductInsightsData> {
    const response = await apiInstance.get<{ data: ProductInsightsData }>('/productInsights', {
      params: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        project_id: params.projectId,
      },
    });

    return response.data.data;
  }
}

export const productInsightsService = new ProductInsightsService();
