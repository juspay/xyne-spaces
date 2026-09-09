import { ActivityEventRepository, CreateActivityEventInput } from '@/database/repositories/activityEventRepository';
import { logger } from '@/utils/logger';
import { ActivityEventPayload } from '@xyne/shared';
import { triggerNudgesFromActivity } from '@/services/nudges/nudgeTriggerService';
import { sudoQueryService } from '@/services/hyperAnalytics/sudoQueryService';
import { resolveModule } from '@/services/hyperAnalytics/moduleRoutes';
import { canonicalizeTrackingCategory } from '@/services/trackingCategoryAliases';

export type { ActivityEventPayload };

class ActivityTrackingService {
  private repository: ActivityEventRepository;

  constructor() {
    this.repository = new ActivityEventRepository();
  }

  private emitToSudoQuery(payload: ActivityEventPayload): void {
    try {
      const resolved = resolveModule(payload.url);
      // Named individually rather than spreading context_metadata: that object
      // can hold free text (INPUT_CHANGE events carry only value length, never
      // the typed content).
      const meta = payload.context_metadata ?? {};

      sudoQueryService.identify({ id: payload.user_id });
      sudoQueryService.track('ui_action', {
        action: `${payload.event_category}/${payload.event_name}`,
        category: payload.event_category,
        name: payload.event_name,
        trigger: payload.trigger_type,
        platform: payload.platform,
        url: payload.url,
        ...(resolved && { module: resolved.module, workspaceId: resolved.workspaceId }),
        // Carries the channel for DB_MUTATION events, whose url is 'backend'.
        // Click events get it from the url instead and rarely set this key.
        ...(typeof meta.channelId === 'string' && { channelId: meta.channelId }),
        ...(typeof meta.path === 'string' && { path: meta.path }),
        // Target URL on ELECTRON_NAVIGATE events.
        ...(typeof meta.to === 'string' && { to: meta.to }),
        ...(typeof meta.label === 'string' && { label: meta.label }),
        ...(typeof meta.tabValue === 'string' && { tabValue: meta.tabValue }),
        ...(typeof meta.tab === 'string' && { tab: meta.tab }),
        ...(Array.isArray(meta.fields) && {
          fields: meta.fields.filter(f => typeof f === 'string').join(','),
        }),
      });
    } catch (err) {
      logger.debug('[ActionMetrics] sudoQuery track failed (non-blocking)', { error: err });
    }
  }

  async saveActivityEvent(rawPayload: ActivityEventPayload): Promise<void> {
    // Clients running older bundles still emit pre-canonicalization category
    // spellings; fold them in here so both sinks aggregate under one name.
    const payload: ActivityEventPayload = {
      ...rawPayload,
      event_category: canonicalizeTrackingCategory(rawPayload.event_category),
    };

    // Emitted before the write so a database failure cannot suppress the
    // metric — the two sinks are independent.
    this.emitToSudoQuery(payload);

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

      // Trigger nudge evaluation for this activity event (fire-and-forget)
      void triggerNudgesFromActivity({
        userId: payload.user_id,
        sessionId: payload.session_id,
        eventCategory: payload.event_category,
        eventName: payload.event_name,
        eventLabel: payload.event_label,
        url: payload.url,
        triggerType: payload.trigger_type,
        contextMetadata: payload.context_metadata,
        platform: payload.platform,
        timestamp: payload.timestamp,
      }).catch((err) => {
        logger.warn('[ACTIVITY-TRACKING] Nudge trigger failed (non-blocking)', {
          error: err instanceof Error ? err.message : err,
          eventCategory: payload.event_category,
          eventName: payload.event_name,
        });
      });
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
