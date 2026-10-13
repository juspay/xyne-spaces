import { sudoQueryService } from './sudoQueryService';
import { resolveFeature, resolveFeatureFromModule } from './featureTaxonomy';
import { logger } from '@/utils/logger';

/**
 * Emits normalized product feature-adoption events into SudoQuery / ClickHouse,
 * reusing the same real-time pipeline as search and module-open metrics.
 *
 * Two event types, both keyed by a single swappable `feature` dimension:
 *   - product_feature_click        one row per user interaction on a feature
 *                                  ("how many unique users clicked on <feature>")
 *   - product_feature_time_spent   dwell seconds on a feature surface
 *                                  ("most vs least time spent")
 *
 * Every method is best-effort and non-blocking: analytics must never fail a
 * user action, so errors are swallowed at debug level.
 */
const FEATURE_CLICK_EVENT = 'product_feature_click';
const TIME_SPENT_EVENT = 'product_feature_time_spent';

interface FeatureClickInput {
  userId: string;
  email?: string;
  eventCategory: string;
  eventName: string;
  eventLabel?: string;
  url?: string;
  workspaceId?: string;
  platform?: string;
}

interface TimeSpentInput {
  userId: string;
  email?: string;
  module: string;
  workspaceId?: string;
  durationSec: number;
  platform?: string;
}

class ProductMetricsService {
  /** Record a single feature interaction (click/open) from the activity stream. */
  trackFeatureClick(input: FeatureClickInput): void {
    try {
      const feature = resolveFeature({
        category: input.eventCategory,
        eventName: input.eventName,
      });
      if (!feature) {
        return;
      }

      sudoQueryService.identify({ id: input.userId, email: input.email });
      sudoQueryService.track(FEATURE_CLICK_EVENT, {
        feature,
        userId: input.userId,
        sourceCategory: input.eventCategory,
        sourceEventName: input.eventName,
        ...(input.eventLabel ? { sourceEventLabel: input.eventLabel } : {}),
        ...(input.url ? { url: input.url } : {}),
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        ...(input.platform ? { platform: input.platform } : {}),
      });
    } catch (error) {
      logger.debug('[ProductMetrics] trackFeatureClick failed (non-blocking)', { error });
    }
  }

  /** Record dwell time on a feature surface, derived from module page duration. */
  trackTimeSpent(input: TimeSpentInput): void {
    try {
      if (!input.durationSec || input.durationSec <= 0) {
        return;
      }
      const feature = resolveFeatureFromModule(input.module);
      if (!feature) {
        return;
      }

      sudoQueryService.identify({ id: input.userId, email: input.email });
      sudoQueryService.track(TIME_SPENT_EVENT, {
        feature,
        module: input.module,
        userId: input.userId,
        durationSec: input.durationSec,
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        ...(input.platform ? { platform: input.platform } : {}),
      });
    } catch (error) {
      logger.debug('[ProductMetrics] trackTimeSpent failed (non-blocking)', { error });
    }
  }
}

export const productMetricsService = new ProductMetricsService();
export type { FeatureClickInput, TimeSpentInput };
