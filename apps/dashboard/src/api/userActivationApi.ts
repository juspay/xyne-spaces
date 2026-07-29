import { UserStatus } from '@xyne/shared';
import { apiInstance } from '../services/clients/apiClient';

export interface BulkStatusUpdateResponse {
  success: boolean;
  message: string;
  successful: string[];
  failed: { userId: string; error: string }[];
}

export const userActivationApi = {
  bulkUpdateStatus: async (
    userIds: string[],
    status: UserStatus,
  ): Promise<BulkStatusUpdateResponse> => {
    const response = await apiInstance.post<BulkStatusUpdateResponse>('/user-activation', {
      userIds,
      status,
    });
    return response.data;
  },

  activateUser: async (userId: string): Promise<BulkStatusUpdateResponse> => {
    return userActivationApi.bulkUpdateStatus([userId], UserStatus.ACTIVE);
  },

  deactivateUser: async (userId: string): Promise<BulkStatusUpdateResponse> => {
    return userActivationApi.bulkUpdateStatus([userId], UserStatus.INACTIVE);
  },
};
