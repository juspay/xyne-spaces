/**
 * PubSub Module
 *
 * Unified watch/subscription management for all external integrations.
 *
 * Usage:
 *   import { pubSubWatchService } from '@/pubsub';
 *
 *   // Setup a watch
 *   await pubSubWatchService.setupSubscription('google-calendar', { id: sourceId, email });
 *
 *   // Renew a watch
 *   await pubSubWatchService.renewSubscription('microsoft-calendar', { id: sourceId, email });
 *
 *   // Stop a watch
 *   await pubSubWatchService.stopSubscription('google-calendar', { id: sourceId, email });
 */

import { PubSubWatchService } from './PubSubWatchService';
import { GmailWatchProvider } from './providers/GmailWatchProvider';
import { GoogleCalendarWatchProvider } from './providers/GoogleCalendarWatchProvider';
import { MicrosoftCalendarWatchProvider } from './providers/MicrosoftCalendarWatchProvider';

// Singleton instance
export const pubSubWatchService = new PubSubWatchService();

// Register all providers
pubSubWatchService.register(new GmailWatchProvider());
pubSubWatchService.register(new GoogleCalendarWatchProvider());
pubSubWatchService.register(new MicrosoftCalendarWatchProvider());

// Re-exports
export { PubSubWatchService } from './PubSubWatchService';
export { GmailWatchProvider } from './providers/GmailWatchProvider';
export { GoogleCalendarWatchProvider } from './providers/GoogleCalendarWatchProvider';
export { MicrosoftCalendarWatchProvider } from './providers/MicrosoftCalendarWatchProvider';
export { watchRenewalQueue } from './queues/WatchRenewalQueue';
