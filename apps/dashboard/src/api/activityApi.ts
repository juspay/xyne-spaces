import { logger, Event as LogEvent } from '../utils/logger';
import { ActivityLogPayload } from '@xyne/shared';
import { apiInstance } from '../services/clients/apiClient';
import { ENABLE_ACTIVITY_LOG } from '../config';

export const activityApi = {
  /**
   * Send activity log to backend
   */
  logActivity: async (payload: ActivityLogPayload): Promise<void> => {
    if (!ENABLE_ACTIVITY_LOG) {
      return;
    }

    try {
      await apiInstance.post('/activity/log', payload, {
        timeout: 5000, // 5 second timeout
      });
    } catch (error) {
      // Log error for monitoring
      logger.warn(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_warn',
        message: String('Activity logging failed:'),
        context: [
          {
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString(),
          },
        ],
      });
    }
  },
};
