import crypto from 'crypto';
import { config } from '@/config/env';

/**
 * Test-only stand-in for Gmail's `users.messages.send`.
 *
 * GoogleService.createEmailSender returns a sender backed by this outbox when
 * the source carries fake credentials and DESK_MOCK_ENABLED is on. Everything
 * above the provider call (emailController, adapters, persistence) runs as in
 * production; only the network send is replaced. Automation reads the outbox
 * through /api/test/fixtures/desk/outbox to assert what would have been sent.
 *
 * State is process-local: local and CI automation run a single backend process.
 */

const MAX_STORED_MAILS = 500;

export interface FakeGmailCredentials {
  fake: true;
  email: string;
}

export interface FakeGmailSentMail {
  kind: 'reply' | 'new';
  messageId: string;
  threadId: string;
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  attachmentCount: number;
  sentAt: string;
}

export interface FakeGmailOutboxFilter {
  threadId?: string;
  to?: string;
}

export function buildFakeGmailCredentials(email: string): FakeGmailCredentials {
  return { fake: true, email };
}

export function isFakeGmailCredentials(credentials: unknown): credentials is FakeGmailCredentials {
  return (
    config.isDeskMockEnabled &&
    typeof credentials === 'object' &&
    credentials !== null &&
    (credentials as { fake?: unknown }).fake === true
  );
}

class FakeGmailOutbox {
  private readonly sent: FakeGmailSentMail[] = [];

  record(mail: Omit<FakeGmailSentMail, 'messageId' | 'threadId' | 'sentAt'> & { threadId?: string }) {
    const messageId = `fake-gmail-message-${crypto.randomUUID()}`;
    const stored: FakeGmailSentMail = {
      ...mail,
      messageId,
      threadId: mail.threadId || `fake-gmail-thread-${crypto.randomUUID()}`,
      to: [...new Set(mail.to)],
      cc: [...new Set(mail.cc)],
      bcc: [...new Set(mail.bcc)],
      sentAt: new Date().toISOString(),
    };
    this.sent.push(stored);
    if (this.sent.length > MAX_STORED_MAILS) {
      this.sent.splice(0, this.sent.length - MAX_STORED_MAILS);
    }
    return stored;
  }

  list(filter: FakeGmailOutboxFilter): FakeGmailSentMail[] {
    const to = filter.to?.toLowerCase();
    return this.sent.filter(
      (mail) =>
        (!filter.threadId || mail.threadId === filter.threadId) &&
        (!to || mail.to.some((recipient) => recipient.toLowerCase() === to))
    );
  }
}

export const fakeGmailOutbox = new FakeGmailOutbox();
