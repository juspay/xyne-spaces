import { apiInstance } from '../services/clients/apiClient';
import type { ClassificationPreviewResult } from '../types/classification';

export const classificationApi = {
  previewClassification: async (
    channelId: string,
    emailSubject: string,
    emailBody: string,
  ): Promise<ClassificationPreviewResult> => {
    const res = await apiInstance.post<ClassificationPreviewResult>(
      `/channels/${channelId}/classification/preview`,
      { emailSubject, emailBody },
    );
    return res.data;
  },

  getAiCategories: async (channelId: string): Promise<string[]> => {
    const res = await apiInstance.get<{ categories: string[] }>(
      `/channels/${channelId}/classification/ai-categories`,
    );
    return res.data.categories;
  },

  patchRawField: async (
    channelId: string,
    ticketId: string,
    fieldName: string,
    fieldValue: string,
  ): Promise<void> => {
    await apiInstance.patch(`/channels/${channelId}/classification/tickets/${ticketId}/raw-field`, {
      fieldName,
      fieldValue,
    });
  },

  overrideClassificationValues: async (
    channelId: string,
    ticketId: string,
    category: string,
    subCategory: string | null,
  ): Promise<{ resolvedGroupId: string | null }> => {
    const res = await apiInstance.put<{ success: boolean; resolvedGroupId: string | null }>(
      `/channels/${channelId}/classification/tickets/${ticketId}/override-values`,
      { category, subCategory },
    );
    return { resolvedGroupId: res.data.resolvedGroupId };
  },
};
