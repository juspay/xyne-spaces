import jwt from 'jsonwebtoken';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';

export type AuthData = {
  sub: string;
  email: string;
  name: string;
  workspaceId: string;
  memberId: string;
};

export function extractAuthDataFromJWT(encodedJWT?: string): AuthData | undefined {
  if (!encodedJWT) {
    return undefined;
  }

  try {
    const decoded = jwt.verify(encodedJWT, config.jwt.secret, {
      issuer: 'xyne',
      audience: 'xyne-user',
    }) as AuthData & { iat?: number };

    if (config.jwt.forceLogoutBefore && decoded.iat && decoded.iat < config.jwt.forceLogoutBefore) {
      return undefined;
    }

    return decoded;
  } catch (error) {
    logger.error('JWT verification failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}
