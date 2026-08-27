import crypto from 'crypto';
import { NextFunction, Request, Response, Router } from 'express';
import {
  AttachmentEntityType,
  EmailType,
  TicketReferenceRelation,
  TicketPriority,
  TicketStatusV2,
  WorkspaceRole,
} from '@prisma/client';
import { db } from '@/database/client';
import { authMiddleware } from '@/middleware/auth';
import { config } from '@/config/env';
import { encrypt } from '@/services/encryptionService';
import { emailService } from '@/services/emailService';
import { mockDeskMailService } from '@/services/mockDeskMailService';
import { externalSourceCore } from '@/integrations/core/core';
import { googleAdapter } from '@/integrations/adapters/google';
import { ChannelExternalSourceResolver } from '@/services/channelExternalSourceResolver';
import { logger } from '@/utils/logger';
import {
  buildMockDeskCredentials as buildMockDeskCredentialsPayload,
  parseMockDeskCredentials,
} from '@/utils/mockDeskCredentials';

const router = Router();
const channelExternalSourceResolver = new ChannelExternalSourceResolver();
// Intentionally permissive for automation fixtures; provider-grade RFC validation
// is covered by the real Gmail/Microsoft integrations.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INCOMING_EMAIL_LIMIT = getPositiveIntegerEnv('MOCK_DESK_INCOMING_EMAIL_LIMIT', 120);
const INCOMING_EMAIL_WINDOW_MS = 60_000;
// Mock-only, process-local rate limiting. This is best-effort protection for
// local/CI fixtures, not a production-grade distributed throttling mechanism.
const incomingEmailTimestampsByChannel = new Map<string, number[]>();
type MockDeskChannelSourceType = 'google' | 'microsoft' | 'slack-desk';

function isDeskMockRouteEnvironment(): boolean {
  return (
    config.isTestEnv ||
    (process.env.ENABLE_DEV_AUTH === 'true' && process.env.NODE_ENV === 'development')
  );
}

function requireMockDeskEnabled(res: Response): boolean {
  if (!isDeskMockRouteEnvironment()) {
    res.status(403).json({ error: 'Desk test mail routes are only available in test/dev auth mode' });
    return false;
  }

  if (!mockDeskMailService.isEnabled()) {
    res.status(403).json({ error: 'DESK_MOCK_ENABLED must be true to use Desk test mail routes' });
    return false;
  }

  return true;
}

function getStringQueryParam(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function getSentMailFilterFromQuery(req: Request): { channelId?: string; conversationId?: string } {
  return {
    channelId: getStringQueryParam(req.query.channelId),
    conversationId: getStringQueryParam(req.query.conversationId),
  };
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function canManageWorkspaceDesk(role: string | undefined): boolean {
  return role === WorkspaceRole.OWNER || role === WorkspaceRole.ADMIN;
}

function getPositiveIntegerEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email.trim());
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function getMockDeskChannelSourceType(value: unknown): MockDeskChannelSourceType {
  if (value === 'microsoft' || value === 'slack-desk') return value;
  return 'google';
}

function getOptionalDateOrNow(value: unknown): Date {
  if (typeof value !== 'string') return new Date();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function getValidEmail(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const email = normalizeEmail(value);
  return isValidEmail(email) ? email : undefined;
}

function getOptionalEmailOrDefault(value: unknown, defaultEmail: string): string | undefined {
  if (typeof value === 'undefined' || value === null || value === '') return defaultEmail;
  return getValidEmail(value);
}

function validateEmailResponse(email: string, label: string, res: Response): boolean {
  if (isValidEmail(email)) return true;
  res.status(400).json({ error: `Invalid ${label} email format` });
  return false;
}

function validateEmailArrayResponse(emails: string[], label: string, res: Response): boolean {
  const invalidEmail = emails.find((email) => !isValidEmail(email));
  if (!invalidEmail) return true;
  res.status(400).json({ error: `Invalid ${label} email format`, email: invalidEmail });
  return false;
}

function buildMockDeskCredentials(payload: Record<string, unknown>): string {
  return encrypt(JSON.stringify(buildMockDeskCredentialsPayload(payload)));
}

function hasMockDeskCredentials(encryptedCredentials: string | null | undefined): boolean {
  return parseMockDeskCredentials(encryptedCredentials).isMock;
}

function rejectNonMockSourceOverwrite(
  source: { id: string; credentials: string | null } | null,
  res: Response
): boolean {
  if (!source || hasMockDeskCredentials(source.credentials)) return false;

  res.status(409).json({
    error:
      'Existing non-mock Desk source found. Mock Desk test routes will not overwrite real provider credentials.',
  });
  return true;
}

function recordIncomingEmailOrReject(channelId: string, res: Response): boolean {
  const now = Date.now();
  const recentTimestamps = (incomingEmailTimestampsByChannel.get(channelId) ?? []).filter(
    (timestamp) => now - timestamp < INCOMING_EMAIL_WINDOW_MS
  );
  if (recentTimestamps.length >= INCOMING_EMAIL_LIMIT) {
    res.status(429).json({
      error: `Mock incoming email limit (${INCOMING_EMAIL_LIMIT}/minute) exceeded for channel`,
    });
    return false;
  }

  recentTimestamps.push(now);
  incomingEmailTimestampsByChannel.set(channelId, recentTimestamps.slice(-INCOMING_EMAIL_LIMIT));
  return true;
}

function resetIncomingEmailRateLimit(): void {
  incomingEmailTimestampsByChannel.clear();
}

async function getCurrentWorkspaceUser(userId: string, workspaceId: string) {
  return db.user.findFirst({
    where: { id: userId, workspaceId },
    select: { id: true, role: true },
  });
}

async function requireWorkspaceDeskManager(
  req: Request,
  res: Response
): Promise<{ workspaceId: string; userId: string } | undefined> {
  const workspaceId = req.user?.workspaceId;
  const userId = req.user?.id;
  if (!workspaceId || !userId) {
    res.status(401).json({ error: 'Authenticated user workspace is required' });
    return undefined;
  }

  const user = await getCurrentWorkspaceUser(userId, workspaceId);
  if (!canManageWorkspaceDesk(user?.role)) {
    res.status(403).json({
      error: 'Only workspace owners and admins can manage mock Desk mail state',
    });
    return undefined;
  }

  return { workspaceId, userId };
}

interface MockAttachmentInput {
  filename: string;
  mimetype?: string;
  size?: number;
}

function isMockAttachmentInput(value: unknown): value is MockAttachmentInput {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<Record<keyof MockAttachmentInput, unknown>>;
  return (
    typeof record.filename === 'string' &&
    (typeof record.mimetype === 'undefined' || typeof record.mimetype === 'string') &&
    (typeof record.size === 'undefined' || typeof record.size === 'number')
  );
}

function asMockAttachments(value: unknown): Array<{
  filename: string;
  mimetype: string;
  size: number;
}> {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!isMockAttachmentInput(item)) return [];
    const filename = item.filename.trim();
    const mimetype = item.mimetype?.trim() || 'text/plain';
    const size =
      typeof item.size === 'number' && Number.isFinite(item.size)
        ? Math.max(1, Math.trunc(item.size))
        : 128;

    return filename ? [{ filename, mimetype, size }] : [];
  });
}

async function createMockEmailAttachments(params: {
  attachments: Array<{ filename: string; mimetype: string; size: number }>;
  emailId: string;
  conversationId: string;
  userId: string;
  workspaceId: string;
}) {
  if (params.attachments.length === 0) return;

  await db.messageAttachment.createMany({
    data: params.attachments.map((attachment) => ({
      entityType: AttachmentEntityType.EMAIL,
      entityId: params.emailId,
      conversationId: params.conversationId,
      workspaceId: params.workspaceId,
      storageProvider: 'mock-desk',
      originalFilename: attachment.filename,
      mimetype: attachment.mimetype,
      size: attachment.size,
      uploadedByUserId: params.userId,
      createdBy: params.userId,
      // Internal mock-only URL scheme used by automation; it is never dereferenced by providers.
      url: `mock-desk://${params.emailId}/${encodeURIComponent(attachment.filename)}`,
      metadata: {
        mock: true,
        source: 'desk-test-route',
      },
    })),
  });
}

router.use(authMiddleware.authenticate);

router.post('/desk/workspace-mailbox', async (req, res, next) => {
  try {
    if (!requireMockDeskEnabled(res)) return;

    const workspaceId = req.user?.workspaceId;
    const userId = req.user?.id;
    if (!workspaceId || !userId) {
      return res.status(401).json({ error: 'Authenticated user workspace is required' });
    }
    const user = await getCurrentWorkspaceUser(userId, workspaceId);
    if (!canManageWorkspaceDesk(user?.role)) {
      return res.status(403).json({
        error: 'Only workspace owners and admins can configure the shared Desk mailbox',
      });
    }

    const sourceType = req.body?.sourceType === 'microsoft' ? 'microsoft' : 'google';
    const email = getOptionalEmailOrDefault(
      req.body?.email,
      `xynedesk.internal+${workspaceId}@${config.deskMockDefaultEmailDomain}`
    );
    if (!email || !validateEmailResponse(email, 'workspace mailbox', res)) return;
    const name = `${sourceType}-mock-workspace-${workspaceId}`;
    const existingSource = await db.externalSource.findUnique({
      where: {
        workspaceId_sourceType: {
          workspaceId,
          sourceType,
        },
      },
      select: { id: true, credentials: true },
    });
    if (rejectNonMockSourceOverwrite(existingSource, res)) return;

    const externalSource = await db.externalSource.upsert({
      where: {
        workspaceId_sourceType: {
          workspaceId,
          sourceType,
        },
      },
      create: {
        name,
        sourceType,
        displayName: email,
        workspaceId,
        ownerUserId: userId,
        credentials: buildMockDeskCredentials({ email, sourceType }),
        isActive: true,
      },
      update: {
        displayName: email,
        ownerUserId: userId,
        credentials: buildMockDeskCredentials({ email, sourceType }),
        isActive: true,
      },
    });

    logger.info('[TestDesk] Mock workspace Desk mailbox configured', {
      workspaceId,
      userId,
      sourceType,
      externalSourceId: externalSource.id,
    });

    return res.json({ success: true, externalSource });
  } catch (error) {
    return next(error);
  }
});

router.post('/desk/channel-source', async (req, res, next) => {
  try {
    if (!requireMockDeskEnabled(res)) return;

    const workspaceId = req.user?.workspaceId;
    const userId = req.user?.id;
    if (!workspaceId || !userId) {
      return res.status(401).json({ error: 'Authenticated user workspace is required' });
    }

    const channelId = typeof req.body?.channelId === 'string' ? req.body.channelId : '';
    if (!channelId) {
      return res.status(400).json({ error: 'channelId is required' });
    }

    const channel = await db.channel.findFirst({
      where: { id: channelId, workspaceId },
      select: { id: true, projectId: true },
    });
    if (!channel) {
      return res.status(404).json({ error: 'Desk channel not found in current workspace' });
    }

    const firstBoard = await db.board.findFirst({
      where: { projectId: channel.projectId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!firstBoard) {
      return res.status(409).json({
        error: 'Project has no boards configured - cannot create personal Desk mailbox',
      });
    }

    const sourceType = getMockDeskChannelSourceType(req.body?.sourceType);
    const persistedSourceType = `mock-${sourceType}-${channelId}`;
    const email = getOptionalEmailOrDefault(
      req.body?.email,
      `mock-personal-${channelId}@${config.deskMockDefaultEmailDomain}`
    );
    if (!email || !validateEmailResponse(email, 'channel mailbox', res)) return;
    // Channel ids are globally unique, so this test source name remains globally
    // unique even though the ExternalSource schema does not include workspaceId
    // in the `name` unique lookup.
    const name = `${sourceType}-mock-channel-${channelId}`;
    const existingSource = await db.externalSource.findUnique({
      where: { name },
      select: { id: true, channelId: true, credentials: true },
    });
    if (existingSource && existingSource.channelId !== channelId) {
      return res.status(409).json({
        error: 'Mock Desk channel source name collision detected for a different channel',
      });
    }
    if (rejectNonMockSourceOverwrite(existingSource, res)) return;

    const externalSource = await db.$transaction(async (tx) => {
      await tx.emailChannelPreference.updateMany({
        where: { channelId },
        data: { boardId: firstBoard.id },
      });

      return tx.externalSource.upsert({
        where: { name },
        create: {
          name,
          sourceType: persistedSourceType,
          displayName: email,
          channelId,
          ownerUserId: userId,
          credentials: buildMockDeskCredentials({ email, sourceType }),
          isActive: true,
        },
        update: {
          sourceType: persistedSourceType,
          displayName: email,
          channelId,
          ownerUserId: userId,
          credentials: buildMockDeskCredentials({ email, sourceType }),
          isActive: true,
        },
      });
    });

    logger.info('[TestDesk] Mock channel Desk source configured', {
      workspaceId,
      userId,
      channelId,
      sourceType,
      externalSourceId: externalSource.id,
    });

    return res.json({ success: true, externalSource });
  } catch (error) {
    return next(error);
  }
});

router.post('/desk/channel-source/:channelId/disconnect', async (req, res, next) => {
  try {
    if (!requireMockDeskEnabled(res)) return;

    const workspaceId = req.user?.workspaceId;
    const userId = req.user?.id;
    const { channelId } = req.params;
    if (!workspaceId || !userId) {
      return res.status(401).json({ error: 'Authenticated user workspace is required' });
    }

    const channel = await db.channel.findFirst({
      where: { id: channelId, workspaceId },
      select: { id: true },
    });
    if (!channel) {
      return res.status(404).json({ error: 'Desk channel not found in current workspace' });
    }

    const user = await getCurrentWorkspaceUser(userId, workspaceId);
    const canManageWorkspaceSource = canManageWorkspaceDesk(user?.role);
    const membership = await db.channelParticipant.findUnique({
      where: { channelId_userId: { channelId, userId } },
      select: { id: true },
    });
    if (!canManageWorkspaceSource && !membership) {
      return res.status(403).json({ error: 'Not a member of this channel' });
    }

    const activeSources = await db.externalSource.findMany({
      where: { channelId, isActive: true },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, sourceType: true, credentials: true, ownerUserId: true },
    });
    const source = activeSources.find((candidate) => hasMockDeskCredentials(candidate.credentials));
    if (!source) {
      if (activeSources.length > 0) {
        return res.status(409).json({
          error: 'No active mock Desk source found for this channel. Refusing to modify real provider credentials.',
        });
      }
      return res.status(404).json({ error: 'No active mock Desk source found for this channel' });
    }
    if (rejectNonMockSourceOverwrite(source, res)) return;
    if (!canManageWorkspaceSource && source.ownerUserId !== userId) {
      return res.status(403).json({ error: 'Only the source owner can disconnect this Desk source' });
    }

    await db.externalSource.update({
      where: { id: source.id },
      data: {
        isActive: false,
        credentials: buildMockDeskCredentials({
          sourceType: source.sourceType,
          disconnected: true,
        }),
      },
    });

    logger.info('[TestDesk] Mock Desk channel source disconnected', {
      workspaceId,
      userId,
      channelId,
      externalSourceId: source.id,
      sourceType: source.sourceType,
    });

    return res.json({ success: true });
  } catch (error) {
    return next(error);
  }
});

router.post('/desk/slack-workspace', async (req, res, next) => {
  try {
    if (!requireMockDeskEnabled(res)) return;

    const workspaceId = req.user?.workspaceId;
    const userId = req.user?.id;
    if (!workspaceId || !userId) {
      return res.status(401).json({ error: 'Authenticated user workspace is required' });
    }

    const name = `slack-mock-workspace-${workspaceId}`;
    const existingSource = await db.externalSource.findUnique({
      where: {
        workspaceId_sourceType: {
          workspaceId,
          sourceType: 'slack',
        },
      },
      select: { id: true, credentials: true },
    });
    if (rejectNonMockSourceOverwrite(existingSource, res)) return;

    const externalSource = await db.externalSource.upsert({
      where: {
        workspaceId_sourceType: {
          workspaceId,
          sourceType: 'slack',
        },
      },
      create: {
        name,
        sourceType: 'slack',
        displayName: 'Mock Slack Workspace',
        workspaceId,
        ownerUserId: userId,
        credentials: buildMockDeskCredentials({
          signingSecret: 'mock-slack-signing-secret',
          botOauthToken: 'xoxb-mock-token',
        }),
        isActive: true,
      },
      update: {
        displayName: 'Mock Slack Workspace',
        ownerUserId: userId,
        credentials: buildMockDeskCredentials({
          signingSecret: 'mock-slack-signing-secret',
          botOauthToken: 'xoxb-mock-token',
        }),
        isActive: true,
      },
    });

    logger.info('[TestDesk] Mock Slack workspace configured', {
      workspaceId,
      userId,
      externalSourceId: externalSource.id,
    });

    return res.json({ success: true, externalSource });
  } catch (error) {
    return next(error);
  }
});

router.post('/desk/incoming-email', async (req, res, next) => {
  try {
    if (!requireMockDeskEnabled(res)) return;

    const userId = req.user?.id;
    const workspaceId = req.user?.workspaceId;
    if (!userId || !workspaceId) {
      return res.status(401).json({ error: 'Authenticated user workspace is required' });
    }

    const channelId = typeof req.body?.channelId === 'string' ? req.body.channelId : '';
    const subject = typeof req.body?.subject === 'string' ? req.body.subject : '';
    const body = typeof req.body?.body === 'string' ? req.body.body : '';
    const from = getValidEmail(req.body?.from) ?? '';
    const to = asStringArray(req.body?.to).map(normalizeEmail);
    const cc = asStringArray(req.body?.cc).map(normalizeEmail);
    const bcc = asStringArray(req.body?.bcc).map(normalizeEmail);
    const replyTo = asStringArray(req.body?.replyTo).map(normalizeEmail);
    const attachments = asMockAttachments(req.body?.attachments);

    if (!channelId || !subject || !from || to.length === 0) {
      return res.status(400).json({
        error: 'channelId, subject, from, and at least one to recipient are required',
      });
    }
    if (
      !validateEmailResponse(from, 'from', res) ||
      !validateEmailArrayResponse(to, 'to recipient', res) ||
      !validateEmailArrayResponse(cc, 'cc recipient', res) ||
      !validateEmailArrayResponse(bcc, 'bcc recipient', res) ||
      !validateEmailArrayResponse(replyTo, 'reply-to recipient', res)
    ) {
      return;
    }

    const channel = await db.channel.findFirst({
      where: { id: channelId, workspaceId },
      select: { id: true },
    });
    if (!channel) {
      return res.status(404).json({ error: 'Desk channel not found in current workspace' });
    }

    const isMember = await db.channelParticipant.findUnique({
      where: { channelId_userId: { channelId, userId } },
      select: { id: true },
    });
    if (!isMember) {
      return res.status(403).json({ error: 'Not a member of this channel' });
    }
    if (!recordIncomingEmailOrReject(channelId, res)) return;

    const externalThreadId =
      typeof req.body?.threadId === 'string' && req.body.threadId.trim()
        ? req.body.threadId.trim()
        : `mock-thread-${crypto.randomUUID()}`;
    const externalMessageId =
      typeof req.body?.messageId === 'string' && req.body.messageId.trim()
        ? req.body.messageId.trim()
        : `mock-message-${crypto.randomUUID()}`;
    const receivedAt = getOptionalDateOrNow(req.body?.receivedAt);

    const existingEmail = await db.email.findFirst({
      where: { channelId, externalThreadId },
      orderBy: { createdAt: 'asc' },
      select: { conversationId: true },
    });

    if (existingEmail) {
      const email = await emailService.addEmailToConversation({
        conversationId: existingEmail.conversationId,
        emailSubject: subject,
        emailBody: body,
        emailTo: to,
        emailFrom: from,
        emailCc: cc,
        emailBcc: bcc,
        emailReplyTo: replyTo,
        externalThreadId,
        externalMessageId,
        emailType: EmailType.DEFAULT,
        receivedAt,
      });
      await createMockEmailAttachments({
        attachments,
        emailId: email.email.id,
        conversationId: existingEmail.conversationId,
        userId,
        workspaceId,
      });

      logger.info('[TestDesk] Mock incoming Desk email appended', {
        workspaceId,
        userId,
        channelId,
        conversationId: existingEmail.conversationId,
        emailId: email.email.id,
        attachmentCount: attachments.length,
      });

      return res.json({
        success: true,
        mode: 'reply',
        conversationId: existingEmail.conversationId,
        emailId: email.email.id,
        externalThreadId,
        externalMessageId,
      });
    }

    const created = await emailService.createConversationWithEmail({
      channelId,
      userId,
      emailSubject: subject,
      emailBody: body,
      emailTo: to,
      emailFrom: from,
      emailCc: cc,
      emailBcc: bcc,
      emailReplyTo: replyTo,
      externalThreadId,
      externalMessageId,
      receivedAt,
    });
    if (!created.isDuplicate && created.email?.id && created.conversation?.conversationId) {
      await createMockEmailAttachments({
        attachments,
        emailId: created.email.id,
        conversationId: created.conversation.conversationId,
        userId,
        workspaceId,
      });
    }

    logger.info('[TestDesk] Mock incoming Desk email created', {
      workspaceId,
      userId,
      channelId,
      conversationId: created.conversation?.conversationId,
      emailId: created.email?.id,
      attachmentCount: attachments.length,
    });

    return res.json({ success: true, mode: 'new', ...created });
  } catch (error) {
    return next(error);
  }
});

router.post('/desk/slack-event', async (req, res, next) => {
  try {
    if (!requireMockDeskEnabled(res)) return;
    const userId = req.user?.id;
    const workspaceId = req.user?.workspaceId;
    const channelId = typeof req.body?.channelId === 'string' ? req.body.channelId : '';
    const from = getValidEmail(req.body?.from) ?? '';
    const subject = typeof req.body?.subject === 'string' ? req.body.subject : '';
    const body = typeof req.body?.body === 'string' ? req.body.body : '';
    if (!userId || !workspaceId) {
      return res.status(401).json({ error: 'Authenticated workspace required' });
    }
    if (!channelId || !from || !subject) {
      return res.status(400).json({ error: 'channelId, from, and subject are required' });
    }
    const member = await db.channelParticipant.findUnique({
      where: { channelId_userId: { channelId, userId } },
      select: { id: true },
    });
    if (!member) return res.status(403).json({ error: 'Not a member of this channel' });
    const created = await emailService.createConversationWithEmail({
      channelId,
      userId,
      emailSubject: subject,
      emailBody: body,
      emailTo: [String(req.body?.to ?? 'slack-channel@slack.example.test')],
      emailFrom: from,
      externalThreadId: String(
        req.body?.threadId ?? `mock-slack-thread-${crypto.randomUUID()}`
      ),
      externalMessageId: String(
        req.body?.messageId ?? `mock-slack-message-${crypto.randomUUID()}`
      ),
      emailType: EmailType.DEFAULT,
    });
    return res.json({ success: true, ...created });
  } catch (error) {
    return next(error);
  }
});

/**
 * Deterministic Pub/Sub-shaped Gmail bulk fixture. It bypasses Google network
 * calls but executes the real Google transformer, ExternalSourceCore dedupe/
 * DL routing, ticket persistence, and Google postprocessor cursor update.
 */
router.post('/desk/pubsub/bulk-gmail', async (req, res, next) => {
  try {
    if (!requireMockDeskEnabled(res)) return;
    const userId = req.user?.id;
    const workspaceId = req.user?.workspaceId;
    const channelId = typeof req.body?.channelId === 'string' ? req.body.channelId : '';
    const historyId = typeof req.body?.historyId === 'string' ? req.body.historyId : '';
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    if (!userId || !workspaceId) {
      return res.status(401).json({ error: 'Authenticated workspace required' });
    }
    if (!channelId || !/^\d+$/.test(historyId) || messages.length === 0) {
      return res.status(400).json({ error: 'channelId, numeric historyId, and messages are required' });
    }
    if (messages.length > 1000) {
      return res.status(400).json({ error: 'A maximum of 1000 messages may be published per fixture' });
    }
    const member = await db.channelParticipant.findUnique({
      where: { channelId_userId: { channelId, userId } },
      select: { id: true },
    });
    if (!member) return res.status(403).json({ error: 'Not a member of this channel' });
    const source = await channelExternalSourceResolver.resolveForChannel(channelId);
    if (!source || source.workspaceId !== workspaceId) {
      return res.status(404).json({ error: 'No Google Desk source found for channel' });
    }
    const invalid = messages.find(
      (message: any) =>
        typeof message?.messageId !== 'string' ||
        typeof message?.threadId !== 'string' ||
        typeof message?.from !== 'string' ||
        typeof message?.subject !== 'string',
    );
    if (invalid) {
      return res.status(400).json({ error: 'Each message requires messageId, threadId, from, and subject' });
    }
    const deterministicAdapter = {
      ...googleAdapter,
      preprocess: async () =>
        messages.map((message: any) => ({
          pubsubData: { emailAddress: source.displayName, historyId },
          parsedEmail: {
            messageId: message.messageId,
            threadId: message.threadId,
            subject: message.subject,
            from: message.from,
            to: Array.isArray(message.to) ? message.to : [source.displayName],
            cc: Array.isArray(message.cc) ? message.cc : [],
            bcc: Array.isArray(message.bcc) ? message.bcc : [],
            replyTo: Array.isArray(message.replyTo) ? message.replyTo : [],
            body: typeof message.body === 'string' ? message.body : '',
            date: typeof message.date === 'string' ? message.date : new Date().toISOString(),
          },
        })),
    };
    const results = await externalSourceCore.ingest(
      deterministicAdapter,
      source.name,
      { messages },
      source,
    );
    return res.json({
      success: true,
      published: messages.length,
      processed: results.length,
      created: results.filter(result => result.action === 'created').length,
      duplicates: results.filter(result => result.action === 'duplicate').length,
      skipped: results.filter(result => result.action === 'skipped').length,
      results,
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/desk/ticket/:conversationId', async (req, res, next) => {
  try {
    if (!requireMockDeskEnabled(res)) return;

    const userId = req.user?.id;
    const workspaceId = req.user?.workspaceId;
    const { conversationId } = req.params;
    if (!userId || !workspaceId) {
      return res.status(401).json({ error: 'Authenticated user workspace is required' });
    }

    const ticket = await db.ticket.findFirst({
      where: { conversationId, workspaceId },
      select: {
        id: true,
        xyneId: true,
        title: true,
        description: true,
        priority: true,
        statusV2: true,
        channelId: true,
        conversationId: true,
        isArchived: true,
      },
    });
    if (!ticket) {
      return res.status(404).json({ error: 'Desk ticket not found' });
    }

    const isMember = await db.channelParticipant.findUnique({
      where: { channelId_userId: { channelId: ticket.channelId, userId } },
      select: { id: true },
    });
    if (!isMember) {
      return res.status(403).json({ error: 'Not a member of this channel' });
    }

    const emails = await db.email.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        subject: true,
        body: true,
        from: true,
        to: true,
        cc: true,
        bcc: true,
        replyTo: true,
        externalThreadId: true,
        externalMessageId: true,
      },
    });
    const attachments = await db.messageAttachment.findMany({
      where: {
        entityType: AttachmentEntityType.EMAIL,
        entityId: { in: emails.map((email) => email.id) },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        entityId: true,
        originalFilename: true,
        mimetype: true,
        size: true,
      },
    });
    const mergeMapping = await db.ticketReferenceMapping.findFirst({
      where: {
        sourceTicketId: ticket.id,
        relationType: TicketReferenceRelation.MERGED_INTO,
      },
      select: { targetTicketId: true },
    });

    return res.json({
      success: true,
      ticket: {
        ...ticket,
        mergedIntoTicketId: mergeMapping?.targetTicketId ?? null,
      },
      emails,
      attachments,
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/desk/channel/:channelId/tickets', async (req, res, next) => {
  try {
    if (!requireMockDeskEnabled(res)) return;
    const userId = req.user?.id;
    const workspaceId = req.user?.workspaceId;
    const { channelId } = req.params;
    if (!userId || !workspaceId) {
      return res.status(401).json({ error: 'Authenticated workspace required' });
    }
    const member = await db.channelParticipant.findUnique({
      where: { channelId_userId: { channelId, userId } },
      select: { id: true },
    });
    if (!member) return res.status(403).json({ error: 'Not a member of this channel' });
    const tickets = await db.ticket.findMany({
      where: { channelId, workspaceId },
      select: { id: true, conversationId: true, title: true },
      orderBy: { createdAt: 'asc' },
    });
    return res.json({ tickets });
  } catch (error) {
    return next(error);
  }
});

router.patch('/desk/ticket/:conversationId', async (req, res, next) => {
  try {
    if (!requireMockDeskEnabled(res)) return;

    const userId = req.user?.id;
    const workspaceId = req.user?.workspaceId;
    const { conversationId } = req.params;
    if (!userId || !workspaceId) {
      return res.status(401).json({ error: 'Authenticated user workspace is required' });
    }

    const priority = typeof req.body?.priority === 'string' ? req.body.priority : undefined;
    const status = typeof req.body?.status === 'string' ? req.body.status : undefined;
    if (
      priority &&
      !Object.values(TicketPriority).includes(priority.toUpperCase() as TicketPriority)
    ) {
      return res.status(400).json({ error: 'Invalid priority' });
    }
    if (status && !Object.values(TicketStatusV2).includes(status.toUpperCase() as TicketStatusV2)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const ticket = await db.ticket.findFirst({
      where: { conversationId, workspaceId },
      select: { id: true, channelId: true },
    });
    if (!ticket) {
      return res.status(404).json({ error: 'Desk ticket not found' });
    }

    const isMember = await db.channelParticipant.findUnique({
      where: { channelId_userId: { channelId: ticket.channelId, userId } },
      select: { id: true },
    });
    if (!isMember) {
      return res.status(403).json({ error: 'Not a member of this channel' });
    }

    const updated = await db.ticket.update({
      where: { id: ticket.id },
      data: {
        ...(priority && { priority: priority.toUpperCase() as TicketPriority }),
        ...(status && {
          statusV2: status.toUpperCase() as TicketStatusV2,
          statusUpdatedAt: new Date(),
        }),
        updatedBy: userId,
      },
      select: {
        id: true,
        xyneId: true,
        title: true,
        priority: true,
        statusV2: true,
        channelId: true,
        conversationId: true,
      },
    });

    return res.json({ success: true, ticket: updated });
  } catch (error) {
    return next(error);
  }
});

router.get('/desk/sent-mails', async (req, res, next) => {
  try {
    if (!requireMockDeskEnabled(res)) return;
    if (!(await requireWorkspaceDeskManager(req, res))) return;

    const filter = getSentMailFilterFromQuery(req);
    const sentMails = mockDeskMailService.listSentMails(filter);
    logger.info('[TestDesk] Mock sent mails listed', {
      count: sentMails.length,
      channelId: filter.channelId,
      conversationId: filter.conversationId,
    });
    return res.json({ sentMails });
  } catch (error) {
    return next(error);
  }
});

router.delete('/desk/sent-mails', async (req, res, next) => {
  try {
    if (!requireMockDeskEnabled(res)) return;
    if (!(await requireWorkspaceDeskManager(req, res))) return;

    const filter = getSentMailFilterFromQuery(req);
    if (!filter.channelId && !filter.conversationId) {
      return res.status(400).json({
        error: 'channelId or conversationId query parameter is required to reset mock Desk sent mails',
      });
    }

    mockDeskMailService.reset(filter);
    logger.info('[TestDesk] Mock sent mails reset', {
      channelId: filter.channelId,
      conversationId: filter.conversationId,
    });
    return res.json({ success: true });
  } catch (error) {
    return next(error);
  }
});

router.post('/desk/mock-dl/reset', async (req, res, next) => {
  try {
    if (!requireMockDeskEnabled(res)) return;
    if (!(await requireWorkspaceDeskManager(req, res))) return;

    mockDeskMailService.resetDlState();
    resetIncomingEmailRateLimit();
    logger.info('[TestDesk] Mock DL state reset');
    return res.json({ success: true });
  } catch (error) {
    return next(error);
  }
});

router.post('/desk/mock-dl', async (req, res, next) => {
  try {
    if (!requireMockDeskEnabled(res)) return;
    if (!(await requireWorkspaceDeskManager(req, res))) return;

    const dlEmail = getValidEmail(req.body?.email) ?? '';
    if (!dlEmail) {
      return res.status(400).json({ error: 'Valid email is required' });
    }

    const dl = mockDeskMailService.createDl(dlEmail);
    logger.info('[TestDesk] Mock DL created', { dlEmail: dl.email });
    return res.json({ success: true, dl });
  } catch (error) {
    return next(error);
  }
});

router.post('/desk/mock-dl/:dlEmail/members', async (req, res, next) => {
  try {
    if (!requireMockDeskEnabled(res)) return;
    if (!(await requireWorkspaceDeskManager(req, res))) return;

    const dlEmail = normalizeEmail(decodeURIComponent(req.params.dlEmail));
    const memberEmail = getValidEmail(req.body?.memberEmail) ?? '';
    if (!validateEmailResponse(dlEmail, 'DL', res)) return;
    if (!memberEmail) {
      return res.status(400).json({ error: 'Valid memberEmail is required' });
    }

    const dl = mockDeskMailService.addDlMember(dlEmail, memberEmail);
    logger.info('[TestDesk] Mock DL member added', { dlEmail: dl.email, memberEmail });
    return res.json({
      success: true,
      dl,
    });
  } catch (error) {
    return next(error);
  }
});

router.delete('/desk/mock-dl/:dlEmail/members/:memberEmail', async (req, res, next) => {
  try {
    if (!requireMockDeskEnabled(res)) return;
    if (!(await requireWorkspaceDeskManager(req, res))) return;

    const dlEmail = normalizeEmail(decodeURIComponent(req.params.dlEmail));
    const memberEmail = normalizeEmail(decodeURIComponent(req.params.memberEmail));
    if (
      !validateEmailResponse(dlEmail, 'DL', res) ||
      !validateEmailResponse(memberEmail, 'member', res)
    ) {
      return;
    }

    const dl = mockDeskMailService.removeDlMember(dlEmail, memberEmail);
    logger.info('[TestDesk] Mock DL member removed', { dlEmail: dl.email, memberEmail });
    return res.json({
      success: true,
      dl,
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/desk/mock-dl/:dlEmail/send', async (req, res, next) => {
  try {
    if (!requireMockDeskEnabled(res)) return;
    if (!(await requireWorkspaceDeskManager(req, res))) return;

    const dlEmail = normalizeEmail(decodeURIComponent(req.params.dlEmail));
    const from = getValidEmail(req.body?.from) ?? '';
    const subject = typeof req.body?.subject === 'string' ? req.body.subject : '';
    const body = typeof req.body?.body === 'string' ? req.body.body : '';
    if (!validateEmailResponse(dlEmail, 'DL', res)) return;
    if (!from || !subject) {
      return res.status(400).json({ error: 'Valid from email and subject are required' });
    }

    const dl = mockDeskMailService.getDl(dlEmail);
    if (dl.members.length === 0) {
      return res.status(404).json({ error: 'Mock DL not found or has no members' });
    }

    const mail = mockDeskMailService.sendToDl({ dlEmail, from, subject, body });
    logger.info('[TestDesk] Mock DL mail sent', {
      dlEmail: mail.dlEmail,
      recipientCount: mail.to.length,
      mailId: mail.id,
    });
    return res.json({
      success: true,
      mail,
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/desk/mock-inbox/:email', async (req, res, next) => {
  try {
    if (!requireMockDeskEnabled(res)) return;
    if (!(await requireWorkspaceDeskManager(req, res))) return;

    const email = normalizeEmail(decodeURIComponent(req.params.email));
    if (!validateEmailResponse(email, 'inbox', res)) return;

    const inbox = mockDeskMailService.getInbox(email);
    logger.info('[TestDesk] Mock inbox listed', { email, count: inbox.length });
    return res.json({
      inbox,
    });
  } catch (error) {
    return next(error);
  }
});

router.use(
  (error: Error & { status?: number }, _req: Request, res: Response, next: NextFunction) => {
    if (!error.status) return next(error);
    return res.status(error.status).json({ error: error.message });
  }
);

export default router;
