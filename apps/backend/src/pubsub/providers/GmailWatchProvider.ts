/**
 * Gmail Watch Provider
 *
 * Manages Gmail push notification watches via Google Pub/Sub.
 * Extracted from GoogleService to live in the unified pubsub system.
 *
 * NOTE: Gmail watches are stored in the ExternalSource table (sourceType='GOOGLE'),
 * not CalendarSyncSubscription. This provider bridges between the unified pubsub
 * service and the existing Gmail infrastructure without changing any logic.
 */

import { BaseWatchProvider, WatchResult, SubscriptionRecord } from '../pubsubTypes';
import { GoogleService } from '@/services/googleService';
import { ExternalSourceRepository } from '@/database/repositories/externalSourceRepository';
import { ExternalSourcePlatform } from '@/integrations/core/types';
import { seedSyncCursor } from '@/services/syncCursorRecovery';

export class GmailWatchProvider extends BaseWatchProvider {
  readonly name = 'gmail';
  readonly platform = 'GOOGLE' as const;

  private externalSourceRepo = new ExternalSourceRepository();

  async renewSubscription(subscription: SubscriptionRecord): Promise<WatchResult> {
    const source = await this.externalSourceRepo.findById(subscription.id);

    if (!source) {
      throw new Error(`No Gmail source found for id ${subscription.id}`);
    }

    if (
      source.sourceType !== ExternalSourcePlatform.GOOGLE &&
      source.sourceType !== 'google-channel-email'
    ) {
      throw new Error(`Source ${source.name} is not a Gmail source`);
    }

    const result = await this.renewSource(source);
    if (!source.lastSyncCursor && result.historyId) {
      await seedSyncCursor({ source, seedHistoryId: result.historyId, reason: 'no-cursor' });
    }

    return result;
  }

  private async renewSource(source: {
    id: string;
    name: string;
    credentials: string;
  }): Promise<WatchResult> {
    const googleService = GoogleService.fromEncryptedCredentials(
      source.credentials,
      source.id
    );

    const result = await googleService.renewGmailWatch();

    return {
      id: source.id,
      expiration: new Date(result.expiration),
      historyId: result.historyId,
    };
  }

  /**
   * Gmail watches expire in ~7 days but we don't store expiration.
   * Since users.watch() is idempotent and cheap, we renew ALL active sources.
   */
  async findExpiring(_beforeDate: Date): Promise<SubscriptionRecord[]> {
    const sources = await this.externalSourceRepo.findAll({
      sourceType: { in: [ExternalSourcePlatform.GOOGLE, 'google-channel-email'] },
      isActive: true,
    });

    return sources.map((s) => ({ id: s.id, email: s.displayName }));
  }

  isPermanentAuthError(error: Error): boolean {
    return /invalid_grant|unauthorized_client|invalid_token/i.test(
      error.message
    );
  }

  async markError(id: string): Promise<void> {
    await this.externalSourceRepo.update(id, { isActive: false });
  }
}
