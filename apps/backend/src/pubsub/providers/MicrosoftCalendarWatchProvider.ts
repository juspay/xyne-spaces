/**
 * Microsoft Calendar Watch Provider
 *
 * Manages Microsoft Graph Change Notification subscriptions for calendar events.
 * Wraps the existing MicrosoftCalendarSubscriptionService without changing any logic.
 */

import { BaseWatchProvider, WatchResult, SubscriptionRecord } from '../pubsubTypes';
import { MicrosoftCalendarSubscriptionService } from '@/services/microsoftCalendarSubscriptionService';
import { repositories } from '@/database/repositories';

export class MicrosoftCalendarWatchProvider extends BaseWatchProvider {
  readonly name = 'microsoft-calendar';
  readonly platform = 'MICROSOFT' as const;

  async setupSubscription(subscription: SubscriptionRecord): Promise<WatchResult> {
    const result = await MicrosoftCalendarSubscriptionService.createSubscriptionForSource(subscription.id);
    return {
      id: result.subscriptionId,
      expiration: result.expiration,
      clientState: result.clientState,
    };
  }

  async renewSubscription(subscription: SubscriptionRecord): Promise<WatchResult> {
    const result = await MicrosoftCalendarSubscriptionService.renewSubscriptionForSource(subscription.id);
    return {
      id: result.subscriptionId,
      expiration: result.expiration,
      clientState: result.clientState,
    };
  }

  async stopSubscription(subscription: SubscriptionRecord): Promise<void> {
    await MicrosoftCalendarSubscriptionService.deleteSubscriptionForSource(subscription.id);
  }

  async findExpiring(beforeDate: Date): Promise<SubscriptionRecord[]> {
    const subs = await repositories.externalSources.findExpiringCalendarSources(beforeDate, 'MICROSOFT');
    return subs.map((s) => ({ id: s.id, email: s.displayName }));
  }

  isPermanentAuthError(error: Error): boolean {
    return /invalid_grant|unauthorized_client/i.test(error.message);
  }

  async markError(id: string): Promise<void> {
    await repositories.externalSources.markCalendarError(id);
  }
}
