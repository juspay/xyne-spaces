import { apiInstance } from '../services/clients/apiClient';

export interface CanvasLabel {
  id: string;
  canvasId: string;
  name: string;
  createdAt: number;
}

export type CanvasLabelsByCanvasId = Record<string, CanvasLabel[]>;

export const canvasLabelsApi = {
  getCanvasLabels: async (canvasIds: string[]): Promise<CanvasLabelsByCanvasId> => {
    if (canvasIds.length === 0) {
      return {};
    }

    const response = await apiInstance.get<{ labels: CanvasLabelsByCanvasId }>('/canvas/labels', {
      params: { canvasIds: canvasIds.join(',') },
    });
    return response.data.labels;
  },

  getCanvasLabelSuggestions: async (query?: string): Promise<string[]> => {
    const response = await apiInstance.get<{ labels: string[] }>('/canvas/labels/suggestions', {
      params: query ? { query } : undefined,
    });
    return response.data.labels;
  },

  addCanvasLabel: async (canvasId: string, name: string): Promise<CanvasLabel> => {
    const response = await apiInstance.post<{ label: CanvasLabel }>(`/canvas/${canvasId}/labels`, {
      name,
    });
    return response.data.label;
  },

  removeCanvasLabel: async (canvasId: string, labelId: string): Promise<void> => {
    await apiInstance.delete(`/canvas/${canvasId}/labels/${labelId}`);
  },
};
