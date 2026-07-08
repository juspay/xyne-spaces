/**
 * Google Calendar Watch Provider
 *
 * Manages Google Calendar push notification channels (webhook watches).
 * Wraps the existing GoogleCalendarWatchService without changing any logic.
 */

import { BaseWatchProvider, WatchResult, SubscriptionRecord } from '../pubsubTypes';
import { GoogleCalendarWatchService } from '@/services/googleCalendarWatchService';
import { repositories } from '@/database/repositories';

export class GoogleCalendarWatchProvider extends BaseWatchProvider {
  readonly name = 'google-calendar';
  readonly platform = 'GOOGLE' as const;

  async setupSubscription(subscription: SubscriptionRecord): Promise<WatchResult> {
    const result = await GoogleCalendarWatchService.setupWatchForSource(subscription.id);
    return {
      id: result.channelId,
      expiration: result.expiration,
      resourceId: result.resourceId,
    };
  }

  async renewSubscription(subscription: SubscriptionRecord): Promise<WatchResult> {
    const result = await GoogleCalendarWatchService.renewWatchForSource(subscription.id);
    return {
      id: result.channelId,
      expiration: result.expiration,
      resourceId: result.resourceId,
    };
  }

  async stopSubscription(subscription: SubscriptionRecord): Promise<void> {
    await GoogleCalendarWatchService.stopWatchForSource(subscription.id);
  }

  async findExpiring(beforeDate: Date): Promise<SubscriptionRecord[]> {
    const subs = await repositories.externalSources.findExpiringCalendarSources(beforeDate, 'GOOGLE');
    return subs.map((s) => ({ id: s.id, email: s.displayName }));
  }

  isPermanentAuthError(error: Error): boolean {
    return /invalid_grant|unauthorized_client/i.test(error.message);
  }

  async markError(id: string): Promise<void> {
    await repositories.externalSources.markCalendarError(id);
  }
}
