import { z } from 'zod';
import { BaseActionStep } from './base-step';
import { StepCategory } from '../types/categories';
import { variableRef } from '../engine/variable-ref';
import { db } from '@/database/client';
import { ensureCsatFormFields } from '@/services/csatFields';
import { csatTokenService } from '@/services/csatTokenService';
import { logger } from '@/utils/logger';
import { emailService } from '@/services/emailService';
import { config as appConfig } from '@/config/env';

const SendCsatRequestConfigSchema = z.object({
  ticketId: variableRef(z.string().min(1)).describe('The ticket to request a satisfaction rating for.'),
  question: variableRef(z.string().optional()).describe('Question shown in the email. Defaults to "How did we do?".'),
});

const SendCsatRequestOutputSchema = z.object({
  ticketId: z.string(),
  emailId: z.string(),
});

interface SendCsatRequestOutput extends Record<string, unknown> {
  ticketId: string;
  emailId: string;
}

/**
 * Sends a CSAT survey email to the customer when triggered (usually on ticket completion).
 * The email itself only has Good/Bad links — clicking one opens a landing page
 * (signed, ticket-scoped token — no login needed) with the real 1-5 star rating
 * and an optional comment. Nothing is recorded until the customer submits that
 * form, so a link-scanner prefetching the email link can't fake a submission.
 */
export class SendCsatRequestStep extends BaseActionStep<
  typeof SendCsatRequestConfigSchema,
  SendCsatRequestOutput
> {
  readonly type = 'SEND_CSAT_REQUEST';
  readonly configSchema = SendCsatRequestConfigSchema;
  readonly outputSchema = SendCsatRequestOutputSchema;
  readonly name = 'Send CSAT request';
  readonly description =
    'Emails the customer a Good/Bad satisfaction survey for a ticket. Clicking through opens a page with the real 1-5 star rating and an optional comment — nothing is recorded until they submit it.';
  readonly category = StepCategory.MESSAGING;
  readonly icon = 'Smile';

  async execute(
    config: z.infer<typeof SendCsatRequestConfigSchema>,
  ): Promise<SendCsatRequestOutput> {
    const ticketId = config.ticketId as string;
    const question = (config.question as string | undefined) || 'How did we do?';

    const ticket = await db.ticket.findUnique({
      where: { id: ticketId },
      select: { conversationId: true, channelId: true, boardId: true, workspaceId: true, createdBy: true },
    });
    if (!ticket) {
      logger.error(`[automations] SEND_CSAT_REQUEST: ticket not found | ticketId=${ticketId}`);
      throw new Error(`[automations] SEND_CSAT_REQUEST: ticket not found | ticketId=${ticketId}`);
    }

    const customerEmail = await this.resolveCustomerEmail(ticket.channelId, ticket.conversationId);
    if (!customerEmail) {
      logger.error(`[automations] SEND_CSAT_REQUEST: could not resolve customer email | ticketId=${ticketId}`);
      throw new Error(`[automations] SEND_CSAT_REQUEST: could not resolve customer email | ticketId=${ticketId}`);
    }

    logger.info(`[automations] SEND_CSAT_REQUEST: resolved customer email=${customerEmail} ticketId=${ticketId}`);

    await ensureCsatFormFields(ticket.boardId, ticket.workspaceId, ticket.createdBy);

    const token = csatTokenService.sign(ticketId);
    const linkBase = `${appConfig.backendUrl}/api/csat/${ticketId}`;
    const goodLink = `${linkBase}?rating=GOOD&token=${encodeURIComponent(token)}`;
    const badLink = `${linkBase}?rating=BAD&token=${encodeURIComponent(token)}`;
    const htmlBody = this.buildEmailBody({ question, goodLink, badLink });

    logger.info(`[automations] SEND_CSAT_REQUEST: sending email to ${customerEmail} for ticketId=${ticketId}`);

    // Verify the channel has proper email setup
    const preference = await db.emailChannelPreference.findUnique({
      where: { channelId: ticket.channelId },
      select: { ownerUserId: true, sendAsEmail: true },
    });
    if (!preference?.ownerUserId) {
      logger.error(`[automations] SEND_CSAT_REQUEST: desk owner not configured | channelId=${ticket.channelId}`);
      throw new Error(`Desk owner not configured for this channel`);
    }

    const owner = await db.user.findUnique({
      where: { id: preference.ownerUserId },
      select: { email: true },
    });
    if (!owner?.email) {
      logger.error(`[automations] SEND_CSAT_REQUEST: desk owner has no email | userId=${preference.ownerUserId}`);
      throw new Error(`Desk owner has no email address configured`);
    }

    // Send via emailService directly for maximum reliability
    try {
      const result = await emailService.sendReplyOnConversation({
        conversationId: ticket.conversationId,
        body: htmlBody,
        type: 'REPLY',
        to: [customerEmail],
      });

      logger.info(
        `[automations] SEND_CSAT_REQUEST sent successfully | ticketId=${ticketId} emailId=${result.emailId} to=${customerEmail}`,
      );

      return { ticketId, emailId: result.emailId };
    } catch (error) {
      logger.error(
        `[automations] SEND_CSAT_REQUEST: failed to send email | ticketId=${ticketId} customerEmail=${customerEmail} error=${
          error instanceof Error ? error.message : error
        }`,
      );
      throw error;
    }
  }

  /**
   * Resolves the customer's email for a conversation — i.e. whichever party is
   * NOT the desk's own address. For inbound emails, the customer is in `from` or
   * `replyTo`. For agent-composed emails, the customer is in the `to` field.
   * This method tries all sources and returns the first valid non-desk address found.
   */
  private async resolveCustomerEmail(channelId: string, conversationId: string): Promise<string | null> {
    const preference = await db.emailChannelPreference.findUnique({
      where: { channelId },
      select: { sendAsEmail: true, ownerUserId: true },
    });
    let deskAddress = preference?.sendAsEmail?.toLowerCase() ?? null;
    if (!deskAddress && preference?.ownerUserId) {
      const owner = await db.user.findUnique({ where: { id: preference.ownerUserId }, select: { email: true } });
      deskAddress = owner?.email?.toLowerCase() ?? null;
    }

    const initialEmail = await db.email.findFirst({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      select: { from: true, to: true, replyTo: true, cc: true },
    });
    if (!initialEmail) {
      logger.warn(
        `[automations] SEND_CSAT_REQUEST: no initial email found for conversation | conversationId=${conversationId}`,
      );
      return null;
    }

    // Try candidates in order of preference
    const candidates = [
      initialEmail.replyTo?.[0],
      initialEmail.from,
      initialEmail.to?.[0],
      initialEmail.cc?.[0],
    ].filter((email): email is string => Boolean(email));

    logger.info(
      `[automations] SEND_CSAT_REQUEST: resolving customer email | deskAddress=${deskAddress} candidates=${candidates.join(
        ', ',
      )}`,
    );

    for (const email of candidates) {
      if (deskAddress && email.toLowerCase() !== deskAddress) {
        logger.info(`[automations] SEND_CSAT_REQUEST: resolved customer email=${email}`);
        return email;
      }
      if (!deskAddress) {
        logger.info(`[automations] SEND_CSAT_REQUEST: resolved customer email=${email} (no deskAddress to filter)`);
        return email;
      }
    }

    logger.warn(`[automations] SEND_CSAT_REQUEST: could not find non-desk email | conversationId=${conversationId}`);
    return null;
  }

  /**
   * Builds an HTML email body with just Good/Bad links. Clicking either only
   * opens the rating page (via csatController.showForm) — no data is recorded
   * from the email itself, only from that page's submit.
   */
  private buildEmailBody({ question, goodLink, badLink }: { question: string; goodLink: string; badLink: string }): string {
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef1f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f6;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 2px rgba(16,24,40,.06);">
        <tr><td style="height:4px;background:#6366f1;line-height:4px;font-size:0;">&nbsp;</td></tr>
        <tr><td style="padding:36px 32px 8px 32px;">
          <p style="margin:0 0 6px 0;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#6366f1;text-align:center;">We'd love your feedback</p>
          <h1 style="margin:0 0 8px 0;font-size:21px;font-weight:650;color:#101828;text-align:center;letter-spacing:-0.01em;">${escapeHtml(question)}</h1>
          <p style="margin:0 0 28px 0;font-size:14px;line-height:20px;color:#667085;text-align:center;">Let us know how we did.</p>
        </td></tr>
        <tr><td style="padding:0 32px 32px 32px;" align="center">
          <a href="${goodLink}" style="display:inline-block;margin:0 8px;padding:11px 28px;background:#16a34a;color:#ffffff;border-radius:10px;text-decoration:none;font-size:14px;font-weight:600;">🙂 Good</a>
          <a href="${badLink}" style="display:inline-block;margin:0 8px;padding:11px 28px;background:#dc2626;color:#ffffff;border-radius:10px;text-decoration:none;font-size:14px;font-weight:600;">🙁 Bad</a>
        </td></tr>
        <tr><td style="padding:16px 32px;background:#f8fafc;border-top:1px solid #eef1f6;">
          <p style="margin:0;font-size:11px;line-height:16px;color:#98a2b3;text-align:center;">You're receiving this because your support ticket was recently marked complete.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const sendCsatRequestStep = new SendCsatRequestStep();
