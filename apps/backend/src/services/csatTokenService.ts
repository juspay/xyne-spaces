import jwt from 'jsonwebtoken';
import { logger } from '@/utils/logger';

const ISSUER = 'xyne-csat';
const AUDIENCE = 'xyne-csat-survey';
const MAX_AGE_SECONDS = 28 * 24 * 60 * 60; // 28 days

class CsatTokenService {
  private readonly secret: string;

  constructor() {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32) {
      throw new Error('JWT_SECRET environment variable is required and must be at least 32 characters');
    }
    this.secret = secret;
  }

  sign(ticketId: string): string {
    return jwt.sign({ ticketId }, this.secret, {
      expiresIn: MAX_AGE_SECONDS,
      issuer: ISSUER,
      audience: AUDIENCE,
    });
  }

  /** True if the token is valid and was issued for this exact ticket. */
  verify(ticketId: string, token: string): boolean {
    try {
      const decoded = jwt.verify(token, this.secret, { issuer: ISSUER, audience: AUDIENCE }) as { ticketId: string };
      return decoded.ticketId === ticketId;
    } catch (err) {
      logger.debug(`[csat-token] verify failed | error=${err}`);
      return false;
    }
  }
}

export const csatTokenService = new CsatTokenService();
