import { invitationEmailHtml, invitationEmailText } from './templates/invitation';
import { config } from '../../config/env';

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface SendEmailParams {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
  fromName?: string;
  replyTo?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
    contentType?: string;
  }>;
}

export interface SendInvitationEmailParams {
  to: string;
  inviterName: string;
  workspaceName: string;
  invitationLink: string;
  invitationId: string;
  tempPassword?: string;
  frontendUrl?: string;
  inviteExperience?: string | null;
}

/**
 * Abstract base class for all email service providers.
 *
 * Concrete providers (e.g. GoogleEmailService) only need to
 * implement `sendEmail` and `verifyConnection`. Transactional email methods
 * like `sendInvitationEmail` are template methods defined here once and
 * delegate to `sendEmail`, so new providers get them for free.
 *
 * Providers can override template methods if they want to use their own
 * provider-native template engines (e.g. SendGrid dynamic templates).
 */
export abstract class BaseEmailService {
  /**
   * Send a raw email. All provider logic lives here.
   */
  abstract sendEmail(params: SendEmailParams): Promise<EmailResult>;

  /**
   * Verify the underlying transport connection.
   * Returns false for no-op / unconfigured providers.
   */
  abstract verifyConnection(): Promise<boolean>;

  /**
   * Template method — builds the invitation HTML/text and delegates to sendEmail.
   * Override in a concrete provider to use a provider-native template engine.
   */
  async sendInvitationEmail(params: SendInvitationEmailParams): Promise<EmailResult> {
    const { to, inviterName, workspaceName, invitationLink, tempPassword, inviteExperience } = params;

    const subject = `You've been invited to join ${workspaceName} on Xyne Spaces`;
    const frontendUrl = params.frontendUrl ?? config.frontendUrl;
    const html = invitationEmailHtml({ inviterName, workspaceName, invitationLink, tempPassword, frontendUrl, inviteExperience });
    const text = invitationEmailText({ inviterName, workspaceName, invitationLink, tempPassword, frontendUrl, inviteExperience });

    return this.sendEmail({ to, subject, html, text });
  }
}
