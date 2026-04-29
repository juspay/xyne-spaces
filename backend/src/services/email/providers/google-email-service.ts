import nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import { BaseEmailService, EmailResult, SendEmailParams } from '../base-email-service';

export class GoogleEmailService extends BaseEmailService {
  private transporter: Transporter | null = null;
  private isConfigured: boolean = false;

  constructor() {
    super();
    this.initializeTransporter();
  }

  private initializeTransporter(): void {
    const { clientId, clientSecret, refreshToken, fromEmail } = config.email;

    if (!clientId || !clientSecret || !refreshToken || !fromEmail) {
      logger.warn(
        '[GoogleEmailService] Not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ' +
          'GOOGLE_REFRESH_TOKEN, and EMAIL_FROM env vars.',
      );
      logger.warn('[GoogleEmailService] Emails will be logged but not sent.');
      this.isConfigured = false;
      return;
    }

    try {
      this.transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          type: 'OAuth2',
          user: fromEmail,
          clientId,
          clientSecret,
          refreshToken,
        },
      });

      this.isConfigured = true;
      logger.info(`[GoogleEmailService] Configured to send from: ${fromEmail}`);
    } catch (error) {
      logger.error('[GoogleEmailService] Failed to initialize transporter:', error);
      this.isConfigured = false;
    }
  }

  async verifyConnection(): Promise<boolean> {
    if (!this.transporter || !this.isConfigured) {
      return false;
    }
    try {
      await this.transporter.verify();
      logger.info('[GoogleEmailService] Connection verified');
      return true;
    } catch (error) {
      logger.error('[GoogleEmailService] Connection verification failed:', error);
      return false;
    }
  }

  async sendEmail(params: SendEmailParams): Promise<EmailResult> {
    const { to, subject, html, text, replyTo, attachments } = params;
    const fromEmail = config.email.fromEmail;
    const fromName = config.email.fromName || 'Xyne Spaces';
    const from = `"${fromName}" <${fromEmail}>`;

    if (!this.isConfigured || !this.transporter) {
      logger.info('[GoogleEmailService] ==================== EMAIL (NOT SENT - NOT CONFIGURED) ====================');
      logger.info(`[GoogleEmailService] To: ${Array.isArray(to) ? to.join(', ') : to}`);
      logger.info(`[GoogleEmailService] Subject: ${subject}`);
      if (text) logger.info(`[GoogleEmailService] Text: ${text}`);
      logger.info('[GoogleEmailService] =====================================================================================');
      return { success: false, error: 'Email service not configured' };
    }

    try {
      const result = await this.transporter.sendMail({
        from,
        to: Array.isArray(to) ? to.join(', ') : to,
        subject,
        html,
        text,
        replyTo,
        attachments,
      });

      logger.info(`[GoogleEmailService] Email sent: ${result.messageId}`);
      return { success: true, messageId: result.messageId };
    } catch (error) {
      logger.error('[GoogleEmailService] Failed to send email:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
