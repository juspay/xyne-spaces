import { ActivityEventRepository, CreateActivityEventInput } from '@/database/repositories/activityEventRepository';
import { logger } from '@/utils/logger';
import { ActivityEventPayload } from '@xyne/shared';

export type { ActivityEventPayload };

class ActivityTrackingService {
  private repository: ActivityEventRepository;

  constructor() {
    this.repository = new ActivityEventRepository();
  }

  async saveActivityEvent(payload: ActivityEventPayload): Promise<void> {
    try {
      const createInput: CreateActivityEventInput = {
        userId: payload.user_id,
        sessionId: payload.session_id,
        eventCategory: payload.event_category,
        eventName: payload.event_name,
        eventLabel: payload.event_label,
        url: payload.url,
        triggerType: payload.trigger_type,
        contextMetadata: payload.context_metadata,
        platform: payload.platform,
        timestamp: new Date(payload.timestamp),
      };

      await this.repository.create(createInput);
    } catch (error) {
      logger.error(`[ACTIVITY-TRACKING] Failed to save activity event`, {
        error: error instanceof Error ? error.message : error,
        eventCategory: payload.event_category,
        eventName: payload.event_name,
      });
    }
  }
}

export const activityTrackingService = new ActivityTrackingService();
