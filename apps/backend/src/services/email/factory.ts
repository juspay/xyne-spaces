import { BaseEmailService } from './base-email-service';
import { GoogleEmailService } from './providers/google-email-service';

/**
 * Factory for email service providers.
 *
 * Currently uses Google OAuth2 via nodemailer.
 * To add a new provider later:
 *  1. Create `providers/<name>-email-service.ts` extending BaseEmailService
 *  2. Add a case to the switch below
 */
export class EmailServiceFactory {
  static create(): BaseEmailService {
    return new GoogleEmailService();
  }
}

/**
 * Module-level singleton. Import `emailService` wherever you need to send mail.
 */
export const emailService: BaseEmailService = EmailServiceFactory.create();
