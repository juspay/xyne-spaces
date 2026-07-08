/**
 * PubSub Types
 *
 * Shared types for the unified watch/subscription management system.
 */

export type Platform = 'GOOGLE' | 'MICROSOFT';

export interface WatchResult {
  id: string;
  expiration: Date;
  resourceId?: string;
  clientState?: string;
  historyId?: string;
}

export interface SubscriptionRecord {
  id: string;
  email: string;
}

export abstract class BaseWatchProvider {
  abstract readonly name: string;
  abstract readonly platform: Platform;

  abstract findExpiring(beforeDate: Date): Promise<SubscriptionRecord[]>;

  abstract isPermanentAuthError(error: Error): boolean;
  abstract markError(id: string, error?: string): Promise<void>;

  async setupSubscription(_subscription: SubscriptionRecord): Promise<WatchResult> {
    throw new Error(`setupSubscription is not implemented for ${this.name}`);
  }

  async renewSubscription(_subscription: SubscriptionRecord): Promise<WatchResult> {
    throw new Error(`renewSubscription is not implemented for ${this.name}`);
  }

  async stopSubscription(_subscription: SubscriptionRecord): Promise<void> {
    throw new Error(`stopSubscription is not implemented for ${this.name}`);
  }
}
