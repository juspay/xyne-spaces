import { Prisma } from '@prisma/client';
import { renderCallInvitationHtml, buildCallInvitationIcs } from '@xyne/shared';
import { repositories } from '@/database/repositories';
import { emailService } from '@/services/emailService';
import { sanitizeEmailBodyHtml } from '@/utils/contentUtils';
import { logger } from '@/utils/logger';
import { buildCallInviteUrl } from '@/utils/urlUtils';

export interface CallInvitationParams {
  externalId: string;
  callTitle: string;
  startsAt: Date;
  endsAt: Date;
  organizerUserId: string;
  externalInvitees: string[];
  invitation: {
    bodyHtml: string;
    title?: string;
    organizerName?: string;
    organizerEmail?: string;
    orgName?: string;
    timezone?: string;
  };
}

async function buildInvitationPayload(params: CallInvitationParams) {
  const organizer = await repositories.users.findById(params.organizerUserId);
  const title = params.invitation.title || params.callTitle;
  const organizerName =
    params.invitation.organizerName || organizer?.name || organizer?.email || 'A colleague';
  const organizerEmail = params.invitation.organizerEmail || organizer?.email || '';
  const timezone = params.invitation.timezone || 'UTC';
  const joinUrl = buildCallInviteUrl(params.externalId);

  const renderedBody = renderCallInvitationHtml({
    title,
    startsAt: params.startsAt,
    endsAt: params.endsAt,
    timezone,
    organizerName,
    organizerEmail,
    ...(params.invitation.orgName && { orgName: params.invitation.orgName }),
    joinUrl,
    userBodyHtml: sanitizeEmailBodyHtml(params.invitation.bodyHtml),
  });

  const ics = buildCallInvitationIcs({
    uid: params.externalId,
    title,
    startsAt: params.startsAt,
    endsAt: params.endsAt,
    organizerName,
    organizerEmail,
    attendeeEmails: params.externalInvitees,
    description: `You have been invited to "${title}" by ${organizerName}.`,
    joinUrl,
  });

  return { title, organizerName, organizerEmail, timezone, joinUrl, renderedBody, ics };
}

export async function sendCallInvitationReply(
  params: CallInvitationParams & { conversationId: string },
  tx?: Prisma.TransactionClient,
): Promise<void> {
  logger.info(
    `[sendCallInvitationReply] Starting call invitation reply | callExternalId=${params.externalId} conversationId=${params.conversationId} organizerUserId=${params.organizerUserId} invitees=${params.externalInvitees.length}`,
  );

  const { title, organizerName, organizerEmail, timezone, joinUrl, renderedBody, ics } =
    await buildInvitationPayload(params);

  logger.info(
    `[sendCallInvitationReply] Rendering invitation | title="${title}" organizer="${organizerName}" organizerEmail="${organizerEmail}" timezone=${timezone} joinUrl=${joinUrl}`,
  );

  logger.info(
    `[sendCallInvitationReply] Sending reply on conversation | conversationId=${params.conversationId} recipients=[${params.externalInvitees.join(', ')}] icsSize=${ics.length} bytes`,
  );

  try {
    const result = await emailService.sendReplyOnConversation(
      {
        conversationId: params.conversationId,
        body: renderedBody,
        type: 'REPLY',
        to: params.externalInvitees,
        fileAttachments: [{ name: 'invite.ics', contentType: 'text/calendar', content: ics }],
      },
      tx,
    );

    logger.info(
      `[sendCallInvitationReply] Call invitation reply sent successfully | callExternalId=${params.externalId} emailId=${result.emailId} threadId=${result.threadId} externalMessageId=${result.externalMessageId}`,
    );
  } catch (err) {
    logger.error(
      `[sendCallInvitationReply] Failed to send call invitation reply | callExternalId=${params.externalId} conversationId=${params.conversationId} error=${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }
}

/**
 * Send a call invitation email to external invitees when there is no conversation/thread.
 * Uses the generic email service to send a standalone email with the invitation.
 */
export async function sendCallInvitationEmail(params: CallInvitationParams): Promise<void> {
  logger.info(
    `[sendCallInvitationEmail] Starting standalone call invitation | callExternalId=${params.externalId} organizerUserId=${params.organizerUserId} invitees=${params.externalInvitees.length}`,
  );

  const { title, organizerName, organizerEmail, timezone, joinUrl, renderedBody, ics } =
    await buildInvitationPayload(params);

  logger.info(
    `[sendCallInvitationEmail] Rendering invitation | title="${title}" organizer="${organizerName}" organizerEmail="${organizerEmail}" timezone=${timezone} joinUrl=${joinUrl}`,
  );

  // Import the generic email service factory for sending standalone emails
  const { emailService: genericEmailService } = await import('@/services/email/factory');

  logger.info(
    `[sendCallInvitationEmail] Sending standalone invitation email | callExternalId=${params.externalId} recipients=[${params.externalInvitees.join(', ')}] icsSize=${ics.length} bytes`,
  );

  try {
    const result = await genericEmailService.sendEmail({
      to: params.externalInvitees,
      subject: `Invitation: ${title}`,
      html: renderedBody,
      attachments: [
        {
          filename: 'invite.ics',
          content: ics,
          contentType: 'text/calendar',
        },
      ],
    });

    if (result.success) {
      logger.info(
        `[sendCallInvitationEmail] Standalone invitation sent successfully | callExternalId=${params.externalId} messageId=${result.messageId}`,
      );
    } else {
      logger.error(
        `[sendCallInvitationEmail] Failed to send standalone invitation | callExternalId=${params.externalId} error=${result.error}`,
      );
    }
  } catch (err) {
    logger.error(
      `[sendCallInvitationEmail] Exception sending standalone invitation | callExternalId=${params.externalId} error=${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }
}
