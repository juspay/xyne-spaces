import { config } from '@/config';
import { buildRandomSuffix } from '@/fixtures/fixture-helpers';
import type {
  MockDeskMailFixture,
  PubSubBatch,
  PubSubMessage,
} from '@/tests/03_e2e/11_xyne-desk/xyne-desk-state';

type MockMailFields = Omit<MockDeskMailFixture, 'alias' | 'to'> & { to?: string };

/** Builds a mock Desk mail fixture addressed to the mock DL unless `to` is given. */
function buildMockMail(alias: string, fields: MockMailFields): MockDeskMailFixture {
  return { alias, to: config.desk.mockDlEmail, ...fields };
}

export function buildIncomingMail(alias: string): MockDeskMailFixture {
  const suffix = buildRandomSuffix();
  return buildMockMail(alias, {
    subject: `Desk happy flow ${suffix}`,
    body: `Customer reported a happy-flow automation issue ${suffix}.`,
    from: `customer.${suffix}@example.test`,
    threadId: `mock-thread-${suffix}`,
    messageId: `mock-message-${suffix}-inbound`,
  });
}

/** Two mails sharing subject and sender domain, on separate threads. */
export function buildAutoMergeMailPair(
  firstAlias: string,
  secondAlias: string
): [MockDeskMailFixture, MockDeskMailFixture] {
  const suffix = buildRandomSuffix();
  const subject = `Desk auto-merge ${suffix}`;
  const domain = 'merge.example.test';
  const build = (alias: string, index: 'one' | 'two'): MockDeskMailFixture =>
    buildMockMail(alias, {
      subject,
      body: `Auto-merge test message ${index} ${suffix}.`,
      from: `customer@${domain}`,
      threadId: `mock-auto-merge-thread-${suffix}-${index}`,
      messageId: `mock-auto-merge-message-${suffix}-${index}`,
    });
  return [build(firstAlias, 'one'), build(secondAlias, 'two')];
}

export function buildReplyAllMailWithAttachment(alias: string): MockDeskMailFixture {
  const suffix = buildRandomSuffix();
  return buildMockMail(alias, {
    subject: `Desk advanced flow ${suffix}`,
    body: `Customer reported an advanced automation issue ${suffix}. Please verify UI, update, reply all, and attachment handling.`,
    from: `customer.${suffix}@example.test`,
    cc: [`manager.${suffix}@example.test`, `observer.${suffix}@example.test`],
    bcc: [],
    replyTo: [`reply.${suffix}@example.test`],
    attachments: [
      {
        filename: `desk-evidence-${suffix}.txt`,
        mimetype: 'text/plain',
        size: 256,
      },
    ],
    threadId: `mock-thread-advanced-${suffix}`,
    messageId: `mock-message-advanced-${suffix}-inbound`,
  });
}

export function buildSlackMessage(alias: string): MockDeskMailFixture {
  const suffix = buildRandomSuffix();
  return buildMockMail(alias, {
    subject: `Slack Desk happy flow ${suffix}`,
    body: `Slack customer message created by automation ${suffix}.`,
    from: `slack.user.${suffix}@example.test`,
    to: `mock-slack-${suffix}@slack.example.test`,
    threadId: `mock-slack-thread-${suffix}`,
    messageId: `mock-slack-message-${suffix}-inbound`,
  });
}

/** A mail the Desk composer will send from `fromEmail` to a fresh recipient. */
export function buildComposedMail(
  alias: string,
  channelAlias: string,
  fromEmail: string
): MockDeskMailFixture {
  const suffix = buildRandomSuffix();
  return buildMockMail(alias, {
    subject: `Desk compose flow ${suffix}`,
    body: `<p>New composed Desk mail from automation ${suffix}.</p>`,
    composedText: `New composed Desk mail from automation ${suffix}.`,
    from: fromEmail,
    to: `compose.recipient.${suffix}@example.test`,
    // The compose UI step enters only To/Subject/body, so the captured mail
    // carries no cc. Keep the fixture consistent with what is actually sent.
    cc: [],
    bcc: [],
    threadId: `mock-compose-thread-${suffix}`,
    messageId: `mock-compose-message-${suffix}`,
    channelAlias,
  });
}

/**
 * Deterministic Gmail Pub/Sub messages for `batchAlias`. The returned `mail`
 * mirrors the first message so mail-level steps can reference the batch.
 */
export function buildPubSubBatch(
  total: number,
  batchAlias: string
): { batch: PubSubBatch; messages: PubSubMessage[]; mail: MockDeskMailFixture } {
  const historyId = String(Date.now());
  const messages = Array.from({ length: total }, (_, index) => ({
    messageId: `mock-pubsub-${batchAlias}-${historyId}-${index}`,
    threadId: `mock-pubsub-thread-${batchAlias}-${index}`,
    from: `bulk-customer-${index}@example.test`,
    // Batch alias in the subject keeps batches distinguishable across channels.
    subject: `Bulk Desk Pub/Sub ${batchAlias} message ${index}`,
    body: `Deterministic Pub/Sub body ${index}`,
  }));
  const firstMessage = messages[0];
  return {
    batch: { messageIds: messages.map((message) => message.messageId), historyId },
    messages,
    mail: buildMockMail(batchAlias, {
      subject: firstMessage.subject,
      body: firstMessage.body,
      from: firstMessage.from,
      threadId: firstMessage.threadId,
      messageId: firstMessage.messageId,
    }),
  };
}
