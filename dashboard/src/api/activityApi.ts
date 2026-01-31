import { ActivityLogPayload } from '@xyne/shared';
import { apiInstance } from '../services/clients/apiClient';

export const activityApi = {
  /**
   * Send activity log to backend
   */
  logActivity: async (payload: ActivityLogPayload): Promise<void> => {
    try {
      await apiInstance.post('/activity/log', payload, {
        timeout: 5000, // 5 second timeout
      });
    } catch (error) {
      // Log error for monitoring
      console.warn('Activity logging failed:', {
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      });
    }
  },
};
