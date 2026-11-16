/**
 * Gmail Pub/Sub notifications, shared by both delivery modes.
 *
 * push: Pub/Sub POSTs to /api/external-source-sync/google/ingest; the route
 *       authenticates the OIDC token and calls the google adapter.
 * pull: gmailPubSubPullWorker reads the subscription and calls
 *       handlePulledGmailNotification, which ends in the same adapter ingest.
 *
 * This file has no runtime imports so the ack/nack decisions can be unit tested
 * without a database; the worker passes the real lookups in as deps.
 */

import type { ExternalSource } from '@prisma/client';
import type { GooglePubSubData, GooglePubSubMessage } from './types';

/** {emailAddress, historyId} from base64 message data, or null when unusable. */
export function decodeGmailNotification(base64Data: string | undefined | null): GooglePubSubData | null {
  if (!base64Data) return null;
  try {
    const data = JSON.parse(Buffer.from(base64Data, 'base64').toString('utf-8')) as Partial<GooglePubSubData>;
    if (typeof data?.emailAddress !== 'string' || !data.emailAddress) return null;
    if (data.historyId === undefined || data.historyId === null || data.historyId === '') return null;
    return { emailAddress: data.emailAddress, historyId: String(data.historyId) };
  } catch {
    return null;
  }
}

/** Why the notification's mailbox is not the source's mailbox, or null when it is. */
export function checkNotificationMailbox(base64Data: string, expectedEmail: string): string | null {
  const data = decodeGmailNotification(base64Data);
  if (!data) return 'Missing emailAddress or historyId in Pub/Sub data';
  if (data.emailAddress !== expectedEmail) {
    return `Email mismatch: expected ${expectedEmail}, got ${data.emailAddress}`;
  }
  return null;
}

export type PullDecision = {
  /** ack: done or never processable. nack: retry later (Pub/Sub backs off, then dead-letters). */
  action: 'ack' | 'nack';
  reason: string;
  emailAddress?: string;
  sourceName?: string;
  resultCount?: number;
  error?: string;
};

export interface PulledNotificationDeps {
  /** Same resolution as the push route: source name from the address, then the display-email fallback. */
  findSource(emailAddress: string): Promise<ExternalSource | null>;
  /** Mailbox address stored in the source's encrypted credentials. */
  credentialsEmail(source: ExternalSource): string | undefined;
  /** The push route's ingest: google adapter preprocess, transform, sync. */
  ingest(source: ExternalSource, payload: GooglePubSubMessage): Promise<unknown[]>;
}

/**
 * Process one pulled message and decide its ack.
 *
 * No OIDC check: only principals with subscriber IAM on the subscription can
 * read it. Redelivery and duplicates are safe because ingest resumes from the
 * source's lastSyncCursor and skips Gmail ids already stored.
 */
export async function handlePulledGmailNotification(
  message: { id: string; data: Buffer; publishTime?: Date },
  subscription: string,
  deps: PulledNotificationDeps,
): Promise<PullDecision> {
  const base64Data = message.data.toString('base64');
  const data = decodeGmailNotification(base64Data);
  if (!data) return { action: 'ack', reason: 'invalid-payload' };

  const { emailAddress } = data;
  let source: ExternalSource | null;
  try {
    source = await deps.findSource(emailAddress);
  } catch (error) {
    return { action: 'nack', reason: 'source-lookup-failed', emailAddress, error: errorMessage(error) };
  }
  // Push answers 200 for an unknown source; a disconnected one would only be
  // redelivered until it expires, so both are acked.
  if (!source) return { action: 'ack', reason: 'unknown-source', emailAddress };
  if (!source.isActive) return { action: 'ack', reason: 'inactive-source', emailAddress, sourceName: source.name };
  if (!source.workspaceId) {
    return { action: 'ack', reason: 'no-workspace', emailAddress, sourceName: source.name };
  }

  let expectedEmail: string | undefined;
  try {
    expectedEmail = deps.credentialsEmail(source);
  } catch (error) {
    // Usually a key or config problem; retry so a fixed deploy picks it up.
    return { action: 'nack', reason: 'credentials-unreadable', emailAddress, sourceName: source.name, error: errorMessage(error) };
  }
  if (!expectedEmail) return { action: 'ack', reason: 'credentials-missing-email', emailAddress, sourceName: source.name };
  const mismatch = checkNotificationMailbox(base64Data, expectedEmail);
  if (mismatch) return { action: 'ack', reason: 'email-mismatch', emailAddress, sourceName: source.name, error: mismatch };

  const payload: GooglePubSubMessage = {
    message: {
      data: base64Data,
      messageId: message.id,
      publishTime: (message.publishTime ?? new Date()).toISOString(),
    },
    subscription,
  };
  try {
    const results = await deps.ingest(source, payload);
    return { action: 'ack', reason: 'processed', emailAddress, sourceName: source.name, resultCount: results.length };
  } catch (error) {
    return { action: 'nack', reason: 'ingest-failed', emailAddress, sourceName: source.name, error: errorMessage(error) };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
