import { apiInstance } from '../services/clients/apiClient';
import type {
  PriorityClassificationPreviewResult,
  SavePriorityConfigPayload,
} from '../types/priorityClassification';

export const priorityClassificationApi = {
  previewClassification: async (
    channelId: string,
    emailSubject: string,
    emailBody: string,
  ): Promise<PriorityClassificationPreviewResult> => {
    const res = await apiInstance.post<PriorityClassificationPreviewResult>(
      `/channels/${channelId}/priority-classification/preview`,
      { emailSubject, emailBody },
    );
    return res.data;
  },

  updateConfig: async (channelId: string, payload: SavePriorityConfigPayload): Promise<void> => {
    await apiInstance.put(`/channels/${channelId}/priority-classification/config`, payload);
  },
};
