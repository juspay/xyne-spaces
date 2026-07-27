/**
 * PubSub Watch Service
 *
 * Central orchestrator for ALL watch/subscription management.
 * Single entry point for setup, renew, stop, and bulk renewal operations.
 */

import { BaseWatchProvider, WatchResult, SubscriptionRecord } from './pubsubTypes';
import { logger } from '@/utils/logger';

const TAG = '[PubSubWatchService]';
const RENEWAL_BATCH_SIZE = 10;

function watchTag(type: string): string {
  if (type === 'google-calendar') return '[CALENDAR_SYNC][GOOGLE][WATCH]';
  if (type === 'microsoft-calendar') return '[CALENDAR_SYNC][MICROSOFT][WATCH]';
  return TAG;
}

export class PubSubWatchService {
  private providers = new Map<string, BaseWatchProvider>();

  register(provider: BaseWatchProvider): void {
    if (this.providers.has(provider.name)) {
      throw new Error(`Provider already registered: ${provider.name}`);
    }
    this.providers.set(provider.name, provider);
    logger.info(`${watchTag(provider.name)} Registered provider`, {
      name: provider.name,
      platform: provider.platform,
    });
  }

  getProvider(name: string): BaseWatchProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new Error(`Unknown provider: ${name}`);
    }
    return provider;
  }

  async setupSubscription(type: string, subscription: SubscriptionRecord): Promise<WatchResult> {
    const provider = this.getProvider(type);
    logger.info(`${watchTag(type)} Setting up watch`, {
      type,
      id: subscription.id,
      email: subscription.email,
    });

    try {
      const result = await provider.setupSubscription(subscription);
      logger.info(`${watchTag(type)} Watch setup complete`, {
        type,
        id: subscription.id,
        email: subscription.email,
        resultId: result.id,
        expiresAt: result.expiration,
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`${watchTag(type)} Watch setup failed`, {
        type,
        id: subscription.id,
        email: subscription.email,
        error: message,
      });
      throw err;
    }
  }

  async renewSubscription(type: string, subscription: SubscriptionRecord): Promise<WatchResult> {
    const provider = this.getProvider(type);
    logger.info(`${watchTag(type)} Renewing watch`, {
      type,
      id: subscription.id,
      email: subscription.email,
    });

    try {
      const result = await provider.renewSubscription(subscription);
      logger.info(`${watchTag(type)} Watch renewed`, {
        type,
        id: subscription.id,
        email: subscription.email,
        resultId: result.id,
        expiresAt: result.expiration,
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`${watchTag(type)} Watch renewal failed`, {
        type,
        id: subscription.id,
        email: subscription.email,
        error: message,
      });
      throw err;
    }
  }

  async stopSubscription(type: string, subscription: SubscriptionRecord): Promise<void> {
    const provider = this.getProvider(type);
    logger.info(`${watchTag(type)} Stopping watch`, {
      type,
      id: subscription.id,
      email: subscription.email,
    });

    try {
      await provider.stopSubscription(subscription);
      logger.info(`${watchTag(type)} Watch stopped`, {
        type,
        id: subscription.id,
        email: subscription.email,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`${watchTag(type)} Watch stop failed`, {
        type,
        id: subscription.id,
        email: subscription.email,
        error: message,
      });
      throw err;
    }
  }

  /**
   * Renew all expiring watches for a given provider type.
   * Returns count of successfully renewed subscriptions.
   */
  async renewAllExpiring(
    type: string,
    withinMs: number
  ): Promise<{ renewed: number; failed: number; deactivated: number }> {
    const provider = this.getProvider(type);
    const cutoff = new Date(Date.now() + withinMs);

    logger.info(`${watchTag(type)} Starting renewal cycle`, { type, cutoff });

    const expiring = await provider.findExpiring(cutoff);
    let renewed = 0;
    let failed = 0;
    let deactivated = 0;

    const renewOne = async (sub: SubscriptionRecord): Promise<void> => {
      try {
        await provider.renewSubscription(sub);
        renewed++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        if (provider.isPermanentAuthError(err as Error)) {
          try {
            await provider.markError(sub.id, message);
            deactivated++;
            logger.error(`${watchTag(type)} Permanent auth failure, deactivated`, {
              type,
              email: sub.email,
              error: message,
            });
          } catch (deactivateErr) {
            logger.error(`${watchTag(type)} Failed to deactivate after auth error`, {
              type,
              email: sub.email,
              error: deactivateErr,
            });
          }
        } else {
          failed++;
          logger.error(`${watchTag(type)} Renewal failed (will retry next cycle)`, {
            type,
            email: sub.email,
            error: message,
          });
        }
      }
    };

    for (let i = 0; i < expiring.length; i += RENEWAL_BATCH_SIZE) {
      const batch = expiring.slice(i, i + RENEWAL_BATCH_SIZE);
      await Promise.all(batch.map(renewOne));
    }

    logger.info(`${watchTag(type)} Renewal cycle complete`, {
      type,
      total: expiring.length,
      renewed,
      failed,
      deactivated,
    });

    return { renewed, failed, deactivated };
  }

  getRegisteredTypes(): string[] {
    return Array.from(this.providers.keys());
  }
}
