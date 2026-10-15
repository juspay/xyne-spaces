import { Request, Response } from 'express';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import { DatabaseClient } from '@/database/client';
import { encrypt } from '@/services/encryptionService';
import { buildFakeGmailCredentials, fakeGmailOutbox } from '@/services/fakeGmailOutbox';
import { ChannelExternalSourceResolver } from '@/services/channelExternalSourceResolver';
import { externalSourceCore } from '@/integrations/core/core';
import { ExternalSourcePlatform } from '@/integrations/core/types';
import {
  googleAdapter,
  type GooglePubSubData,
  type ParsedEmailData,
} from '@/integrations/adapters/google';
import { upsertMockDeskChannelSourceTx } from '@/bypassAcl/transactions/mockDeskChannelSource';

const MAX_DELIVERY_MESSAGES = 1000;

interface FixtureGmailMessage {
  messageId: string;
  threadId: string;
  from: string;
  subject: string;
  body?: string;
  to?: string[];
  cc?: string[];
  replyTo?: string[];
}

/**
 * Thrown by the delivery fixture to simulate a worker crash mid-batch, so the
 * route answers the way a nacked Pub/Sub push would (retryable 503).
 */
class InjectedDeliveryFailure extends Error {}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isFixtureGmailMessage(value: unknown): value is FixtureGmailMessage {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.messageId === 'string' &&
    typeof record.threadId === 'string' &&
    typeof record.from === 'string' &&
    typeof record.subject === 'string' &&
    (record.body === undefined || typeof record.body === 'string') &&
    (record.to === undefined || isStringArray(record.to)) &&
    (record.cc === undefined || isStringArray(record.cc)) &&
    (record.replyTo === undefined || isStringArray(record.replyTo))
  );
}

/**
 * Test-only Desk fixture endpoints under /api/test/*, usable in the Docker test
 * stack (NODE_ENV=test) and in local dev with dev auth (TEST_ENV=local runs),
 * the same environments /api/test is mounted in, and only with DESK_MOCK_ENABLED.
 *
 * They stand in for the two things automation cannot drive for real: the
 * Google OAuth mailbox connection, and Gmail delivering a mail. Everything
 * downstream (ingestion, ticket creation, dedup, replies) runs the product
 * code. Assertions belong in the UI or real APIs, not here; the only read
 * endpoint is the fake Gmail outbox, i.e. the provider boundary.
 *
 * @security NEVER expose in production.
 */
export class TestDeskFixturesController {
  private channelExternalSourceResolver = new ChannelExternalSourceResolver();

  private rejectUnlessEnabled(res: Response): boolean {
    const isLocalDevAuth =
      process.env.ENABLE_DEV_AUTH === 'true' && process.env.NODE_ENV === 'development';
    if (!(config.isTestEnv || isLocalDevAuth) || !config.isDeskMockEnabled) {
      res.status(403).json({
        error: 'Forbidden',
        message:
          'Desk fixture endpoints need NODE_ENV=test (or local dev auth) and DESK_MOCK_ENABLED=true',
      });
      return true;
    }
    return false;
  }

  /**
   * Connects a fake Gmail mailbox to a Desk channel: the state the OAuth
   * connect flow leaves behind (channel ExternalSource + email preference).
   */
  connectChannelMailbox = async (req: Request, res: Response): Promise<void> => {
    try {
      if (this.rejectUnlessEnabled(res)) return;

      const { channelId, mailboxEmail, ownerEmail } = req.body as Record<string, unknown>;
      if (
        typeof channelId !== 'string' ||
        typeof mailboxEmail !== 'string' ||
        typeof ownerEmail !== 'string'
      ) {
        res.status(400).json({
          error: 'Invalid request',
          message: 'channelId, mailboxEmail and ownerEmail are required',
        });
        return;
      }

      const db = DatabaseClient.getInstance();
      const channel = await db.channel.findUnique({
        where: { id: channelId },
        select: { id: true, projectId: true, workspaceId: true },
      });
      if (!channel) {
        res.status(404).json({ error: 'Channel not found', message: `No channel ${channelId}` });
        return;
      }

      const owner = await db.user.findFirst({
        where: { email: ownerEmail, workspaceId: channel.workspaceId },
        select: { id: true },
      });
      if (!owner) {
        res.status(400).json({
          error: 'Unknown owner',
          message: `${ownerEmail} is not in workspace ${channel.workspaceId}`,
        });
        return;
      }

      const firstBoard = await db.board.findFirst({
        where: { projectId: channel.projectId },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (!firstBoard) {
        res.status(409).json({
          error: 'No board',
          message: `Project ${channel.projectId} has no boards for Desk tickets`,
        });
        return;
      }

      const source = await upsertMockDeskChannelSourceTx({
        name: `${ExternalSourcePlatform.GOOGLE}-fake-channel-${channelId}`,
        workspaceId: channel.workspaceId,
        userId: owner.id,
        channelId,
        boardId: firstBoard.id,
        email: mailboxEmail,
        sourceType: ExternalSourcePlatform.GOOGLE,
        credentials: encrypt(JSON.stringify(buildFakeGmailCredentials(mailboxEmail))),
      });

      res.status(200).json({ success: true, channelId, externalSourceId: source.id });
    } catch (error) {
      logger.error('[TestDeskFixtures] Failed to connect channel mailbox', error);
      res.status(500).json({
        error: 'Failed to connect channel mailbox',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  /**
   * Delivers Gmail messages to a channel's mailbox through the real ingestion
   * pipeline (externalSourceCore.ingest + googleAdapter); only the Gmail API
   * fetch in preprocess is replaced. `failAtMessageId` fails that one message
   * on this delivery so redelivery and dedup can be exercised.
   */
  deliverGmailMessages = async (req: Request, res: Response): Promise<void> => {
    try {
      if (this.rejectUnlessEnabled(res)) return;

      const { channelId, historyId, messages, failAtMessageId } = req.body as Record<
        string,
        unknown
      >;
      if (
        typeof channelId !== 'string' ||
        typeof historyId !== 'string' ||
        !/^\d+$/.test(historyId) ||
        !Array.isArray(messages) ||
        messages.length === 0 ||
        messages.length > MAX_DELIVERY_MESSAGES ||
        !messages.every(isFixtureGmailMessage) ||
        (failAtMessageId !== undefined && typeof failAtMessageId !== 'string')
      ) {
        res.status(400).json({
          error: 'Invalid request',
          message: `channelId, numeric historyId and 1-${MAX_DELIVERY_MESSAGES} messages (messageId, threadId, from, subject) are required`,
        });
        return;
      }

      const source = await this.channelExternalSourceResolver.resolveForChannel(channelId);
      if (!source) {
        res.status(404).json({ error: 'No mailbox', message: `Channel ${channelId} has no mailbox` });
        return;
      }

      const fixtureAdapter = {
        ...googleAdapter,
        transform: (...[payload, src]: Parameters<typeof googleAdapter.transform>) => {
          const parsedEmail = (payload as { parsedEmail?: Pick<ParsedEmailData, 'messageId'> })
            ?.parsedEmail;
          if (failAtMessageId && parsedEmail?.messageId === failAtMessageId) {
            throw new InjectedDeliveryFailure(`Injected retryable failure at ${failAtMessageId}`);
          }
          return googleAdapter.transform(payload, src);
        },
        preprocess: async (): Promise<
          Array<{ pubsubData: GooglePubSubData; parsedEmail: ParsedEmailData }>
        > =>
          messages.map((message) => ({
            pubsubData: { emailAddress: source.displayName, historyId },
            parsedEmail: {
              messageId: message.messageId,
              threadId: message.threadId,
              subject: message.subject,
              from: message.from,
              to: message.to ?? [source.displayName],
              cc: message.cc ?? [],
              bcc: [],
              replyTo: message.replyTo ?? [],
              body: message.body ?? '',
              date: new Date().toISOString(),
            },
          })),
      };

      let results;
      try {
        results = await externalSourceCore.ingest(fixtureAdapter, source.name, { messages }, source);
      } catch (error) {
        if (error instanceof InjectedDeliveryFailure) {
          res.status(503).json({ success: false, retryable: true, error: error.message });
          return;
        }
        throw error;
      }

      res.status(200).json({
        success: true,
        delivered: messages.length,
        created: results.filter((result) => result.action === 'created').length,
        duplicates: results.filter((result) => result.action === 'duplicate').length,
        skipped: results.filter((result) => result.action === 'skipped').length,
        // One ingestion result per message, in delivery order.
        conversationIds: results.map((result) => result.conversationId),
      });
    } catch (error) {
      logger.error('[TestDeskFixtures] Failed to deliver Gmail messages', error);
      res.status(500).json({
        error: 'Failed to deliver Gmail messages',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  /** Mails the product sent through the fake Gmail sender (provider boundary). */
  listOutbox = async (req: Request, res: Response): Promise<void> => {
    if (this.rejectUnlessEnabled(res)) return;

    const threadId = typeof req.query.threadId === 'string' ? req.query.threadId : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    if (!threadId && !to) {
      res.status(400).json({ error: 'Invalid request', message: 'threadId or to is required' });
      return;
    }

    res.status(200).json({ sent: fakeGmailOutbox.list({ threadId, to }) });
  };
}
