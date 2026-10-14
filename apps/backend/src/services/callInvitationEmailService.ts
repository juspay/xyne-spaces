import { Prisma } from '@prisma/client';
import { renderCallInvitationHtml, buildCallInvitationIcs } from '@xyne/shared';
import { repositories } from '@/database/repositories';
import { emailService } from '@/services/emailService';
import { sanitizeEmailBodyHtml } from '@/utils/contentUtils';
import { logger } from '@/utils/logger';
import { normalizeEmailList } from '@/utils/email';

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
  const [organizer, call] = await Promise.all([
    repositories.users.findById(params.organizerUserId),
    repositories.calls.findByExternalId(params.externalId),
  ]);
  if (!call?.roomLink) {
    throw new Error(`Stored roomLink not found for call ${params.externalId}`);
  }

  const title = params.invitation.title || params.callTitle;
  const organizerName =
    params.invitation.organizerName || organizer?.name || organizer?.email || 'A colleague';
  const organizerEmail = params.invitation.organizerEmail || organizer?.email || '';
  const timezone = params.invitation.timezone || 'UTC';
  const joinUrl = call.roomLink;

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

/** Internal participants are only emailed when the call has at most this many of them. */
export const MAX_INTERNAL_EMAIL_RECIPIENTS = 100;

/** Single calls are stored as UTC, so their emails are shown in IST. */
export const resolveEmailTimezone = (stored?: string | null): string =>
  !stored || stored === 'UTC' ? 'Asia/Kolkata' : stored;

/** Strips line breaks from user-derived values before they go into a log line. */
export const sanitizeForLog = (value: unknown): string => String(value ?? '').replace(/[\r\n]+/g, ' ');

export type CallChangeEmailKind = 'created' | 'updated' | 'cancelled';

const CHANGE_EMAIL_COPY: Record<CallChangeEmailKind, { heading: string; subject: string }> = {
  created: { heading: 'Meeting invitation', subject: 'Invitation' },
  updated: { heading: 'Meeting updated', subject: 'Updated' },
  cancelled: { heading: 'Meeting cancelled', subject: 'Cancelled' },
};

export interface CallChangeEmailParams {
  kind: CallChangeEmailKind;
  /** Any instance of the call; supplies the join link. */
  externalId: string;
  callTitle: string;
  startsAt: Date;
  endsAt: Date;
  timezone?: string | null | undefined;
  organizerUserId: string;
  externalEmails: string[];
  /** Skipped entirely when there are more than MAX_INTERNAL_EMAIL_RECIPIENTS. */
  internalUserIds: string[];
  excludeUserIds?: string[];
  /** Plain-text lines shown in the body (what changed). Escaped here. */
  changeLines?: string[];
  bodyHtml?: string;
}

const escapeHtml = (v: string): string =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** "Wed, Oct 8, 04:00 PM – 05:00 PM" in the given zone (falls back to UTC on a bad zone). */
export function formatCallWindow(startsAt: Date, endsAt: Date, timezone?: string | null): string {
  const fmt = (tz: string) => {
    const day = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(startsAt);
    const time = (d: Date) =>
      new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(d);
    return `${day}, ${time(startsAt)} – ${time(endsAt)} (${tz})`;
  };
  try {
    return fmt(timezone || 'UTC');
  } catch {
    return fmt('UTC');
  }
}

/**
 * Email a call's participants about a create / update / cancel / removal.
 * Callers invoke this only when the organizer opted in.
 * Recipients are deduped by address and sent a single email (all in To), like a calendar invite.
 */
export async function sendCallChangeEmails(params: CallChangeEmailParams): Promise<void> {
  const exclude = new Set(params.excludeUserIds ?? []);
  exclude.add(params.organizerUserId);

  let internalUserIds = [...new Set(params.internalUserIds)].filter((id) => !exclude.has(id));
  if (internalUserIds.length > MAX_INTERNAL_EMAIL_RECIPIENTS) {
    logger.warn(
      `[sendCallChangeEmails] Skipping internal participants, over cap | externalId=${sanitizeForLog(params.externalId)} kind=${params.kind} count=${internalUserIds.length}`,
    );
    internalUserIds = [];
  }

  const [organizer, call, internalUsers] = await Promise.all([
    repositories.users.findById(params.organizerUserId),
    repositories.calls.findByExternalId(params.externalId),
    internalUserIds.length > 0
      ? repositories.users.getEmailsByIds(internalUserIds)
      : Promise.resolve([]),
  ]);

  const organizerEmail = organizer?.email?.toLowerCase();
  const recipients = normalizeEmailList([
    ...params.externalEmails,
    ...internalUsers.map((u) => u.email),
  ]).filter((email) => email !== organizerEmail);
  if (recipients.length === 0) return;

  const copy = CHANGE_EMAIL_COPY[params.kind];
  const timezone = resolveEmailTimezone(params.timezone || call?.timezone);
  const joinUrl = call?.roomLink ?? '';
  const lines = params.changeLines ?? [];
  const userBodyHtml =
    params.kind === 'created' && params.bodyHtml
      ? sanitizeEmailBodyHtml(params.bodyHtml)
      : `<ul style="margin:0;padding-left:20px">${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`;

  const html = renderCallInvitationHtml({
    title: params.callTitle,
    startsAt: params.startsAt,
    endsAt: params.endsAt,
    timezone,
    organizerName: organizer?.name || organizer?.email || 'A colleague',
    organizerEmail: organizer?.email ?? '',
    joinUrl,
    userBodyHtml,
    heading: copy.heading,
    hideJoin: params.kind === 'cancelled' || !joinUrl,
  });

  const { emailService: genericEmailService } = await import('@/services/email/factory');
  const result = await genericEmailService.sendEmail({
    to: recipients,
    subject: `${copy.subject}: ${params.callTitle}`,
    html,
  });
  if (!result.success) {
    logger.error(
      `[sendCallChangeEmails] Failed | externalId=${sanitizeForLog(params.externalId)} kind=${params.kind} recipients=${recipients.length} error=${sanitizeForLog(result.error)}`,
    );
  }
  logger.info(
    `[sendCallChangeEmails] Done | externalId=${sanitizeForLog(params.externalId)} kind=${params.kind} recipients=${recipients.length}`,
  );
}
