/**
 * Gmail Pub/Sub StreamingPull subscriber (GOOGLE_PUBSUB_DELIVERY_MODE=pull).
 *
 * Opens an outbound StreamingPull connection to pubsub.googleapis.com and feeds
 * each notification into the same google adapter ingest the push webhook uses,
 * so a stack needs no public endpoint. Messages arrive as Gmail publishes them;
 * there is no polling interval. Started by worker.ts when ENABLE_GMAIL_PULL_WORKER
 * is set; several replicas can share the subscription.
 */

import type { Message, Subscription } from '@google-cloud/pubsub';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import '@/integrations';
import { googleAdapter } from '@/integrations/adapters/google';
import {
  handlePulledGmailNotification,
  type PullDecision,
  type PulledNotificationDeps,
} from '@/integrations/adapters/google/pubsubNotification';
import type { GoogleCredentials } from '@/integrations/adapters/google/types';
import { ingestExternalSource } from '@/bypassAcl/webhookIngestServices';
import { ExternalSourceRepository } from '@/database/repositories/externalSourceRepository';
import { decrypt } from '@/services/encryptionService';
import { GoogleService } from '@/services/googleService';

const TAG = '[GmailPullWorker]';
const STATS_INTERVAL_MS = 60_000;
// Keep extending a message's lease while ingest runs (long attachment downloads).
const MAX_LEASE_EXTENSION_MINUTES = 30;

const repo = new ExternalSourceRepository();

const deps: PulledNotificationDeps = {
  // Same lookup as the push route's authenticate middleware.
  async findSource(emailAddress) {
    return (
      (await repo.findByName(GoogleService.getSourceName(emailAddress)))
      ?? (await repo.findGoogleSourceByDisplayEmail(emailAddress))
    );
  },
  credentialsEmail(source) {
    return (JSON.parse(decrypt(source.credentials)) as Partial<GoogleCredentials>).email;
  },
  ingest(source, payload) {
    return ingestExternalSource(source.workspaceId, googleAdapter, source.name, payload, source);
  },
};

type Counters = { received: number; processed: number; skipped: number; retried: number; streamErrors: number };

class GmailPubSubPullWorker {
  private subscription: Subscription | null = null;
  private statsTimer: NodeJS.Timeout | null = null;
  private counters: Counters = this.zeroCounters();
  /** Per-mailbox chains: one mailbox's notifications run one at a time, so they don't race on its cursor. */
  private mailboxChains = new Map<string, Promise<void>>();
  private inFlight = new Set<Promise<void>>();
  private stopping = false;

  async start(): Promise<void> {
    if (this.subscription) return;
    const subscriptionName = GoogleService.getPullSubscriptionName();
    const maxMessages = config.google.pubsubPullMaxMessages;

    // Creates the subscription when missing, so the worker can start before any source connects.
    await GoogleService.setupPullSubscription();

    const pubsub = GoogleService.createPubSubClient();
    const subscription = pubsub.subscription(subscriptionName, {
      flowControl: { maxMessages, allowExcessMessages: false, maxExtensionMinutes: MAX_LEASE_EXTENSION_MINUTES },
    });
    subscription.on('message', (message: Message) => this.onMessage(message, subscriptionName));
    // The client reconnects by itself after stream errors; log so outages show up.
    subscription.on('error', error => {
      this.counters.streamErrors += 1;
      logger.error(`${TAG} StreamingPull error (client will reconnect)`, {
        subscriptionName,
        code: (error as { code?: number }).code,
        error: error.message,
      });
    });
    subscription.on('close', () => logger.info(`${TAG} subscription closed`, { subscriptionName }));
    this.subscription = subscription;

    this.statsTimer = setInterval(() => this.logStats(subscriptionName), STATS_INTERVAL_MS);
    this.statsTimer.unref();

    logger.info(`${TAG} started`, {
      mode: config.google.pubsubDeliveryMode,
      subscription: subscriptionName,
      topic: config.google.pubsubTopic,
      project: config.google.cloudProjectId,
      maxMessages,
      credentials: config.google.pubsubServiceAccountBase64 ? 'service-account-key' : 'application-default',
    });
  }

  private onMessage(message: Message, subscriptionName: string): void {
    // Removing the listener would close the stream before in-flight acks flush, so hand new ones back instead.
    if (this.stopping) {
      message.nack();
      return;
    }
    this.counters.received += 1;
    const key = mailboxKey(message.data);
    const previous = this.mailboxChains.get(key) ?? Promise.resolve();
    const run = previous.then(() => this.process(message, subscriptionName));
    this.mailboxChains.set(key, run);
    this.inFlight.add(run);
    void run.finally(() => {
      this.inFlight.delete(run);
      if (this.mailboxChains.get(key) === run) this.mailboxChains.delete(key);
    });
  }

  private async process(message: Message, subscriptionName: string): Promise<void> {
    const startedAt = Date.now();
    let decision: PullDecision;
    try {
      decision = await handlePulledGmailNotification(
        { id: message.id, data: message.data, publishTime: message.publishTime },
        subscriptionName,
        deps,
      );
    } catch (error) {
      decision = { action: 'nack', reason: 'handler-threw', error: error instanceof Error ? error.message : String(error) };
    }

    const context = {
      messageId: message.id,
      deliveryAttempt: message.deliveryAttempt,
      reason: decision.reason,
      emailAddress: decision.emailAddress,
      sourceName: decision.sourceName,
      resultCount: decision.resultCount,
      durationMs: Date.now() - startedAt,
      ...(decision.error && { error: decision.error }),
    };

    if (decision.action === 'nack') {
      this.counters.retried += 1;
      logger.warn(`${TAG} nack, Pub/Sub will redeliver`, context);
      message.nack();
      return;
    }
    if (decision.reason === 'processed') {
      this.counters.processed += 1;
      logger.debug(`${TAG} processed`, context);
    } else {
      this.counters.skipped += 1;
      logger.warn(`${TAG} acked without ingest`, context);
    }
    message.ack();
  }

  private logStats(subscriptionName: string): void {
    const counters = this.counters;
    this.counters = this.zeroCounters();
    logger.info(`${TAG} last ${STATS_INTERVAL_MS / 1000}s`, {
      subscriptionName,
      ...counters,
      inFlight: this.inFlight.size,
    });
  }

  private zeroCounters(): Counters {
    return { received: 0, processed: 0, skipped: 0, retried: 0, streamErrors: 0 };
  }

  /** Stop taking messages, let in-flight ones finish (or nack them on timeout), then close. */
  async shutdown(timeoutMs = 25_000): Promise<void> {
    const subscription = this.subscription;
    if (!subscription) return;
    this.stopping = true;
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = null;

    const pending = Promise.allSettled([...this.inFlight]);
    const timedOut = await Promise.race([
      pending.then(() => false),
      new Promise<boolean>(resolve => setTimeout(() => resolve(true), timeoutMs).unref()),
    ]);
    if (timedOut) {
      logger.warn(`${TAG} shutdown timed out with ${this.inFlight.size} message(s) in flight; their leases will expire`);
    }
    // close() flushes pending acks/nacks; unacked messages go back to the subscription.
    await subscription.close();
    this.subscription = null;
    this.stopping = false;
    logger.info(`${TAG} stopped`);
  }
}

/** Mailbox address for chaining, or the raw data so malformed messages still run on their own. */
function mailboxKey(data: Buffer): string {
  try {
    const parsed = JSON.parse(data.toString('utf-8')) as { emailAddress?: unknown };
    if (typeof parsed.emailAddress === 'string') return parsed.emailAddress.toLowerCase();
  } catch {
    // fall through
  }
  return `raw:${data.toString('base64').slice(0, 64)}`;
}

export const gmailPubSubPullWorker = new GmailPubSubPullWorker();
