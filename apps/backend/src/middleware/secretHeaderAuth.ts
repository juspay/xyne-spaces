import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { logger } from '@/utils/logger';

interface SecretHeaderAuthOptions {
  /** Lowercase request header carrying the shared secret. */
  header: string;
  /** Expected secret, from the Joi-validated config. Empty rejects every request. */
  expectedSecret: string;
  /** Log key used when the comparison itself blows up. */
  failureLogKey: string;
}

/**
 * Build a service-to-service auth middleware that compares a shared secret sent
 * in a request header against the expected one.
 *
 * Every rejection is an opaque 401 so a caller cannot tell a missing secret from
 * a wrong one, and the comparison is constant-time (crypto.timingSafeEqual) so
 * the secret cannot be recovered byte-by-byte from response timings.
 *
 * An unconfigured (empty) expected secret rejects every request, so an endpoint
 * is never left open because its secret was not set. This is the single place
 * that contract is implemented.
 */
export const createSecretHeaderAuth = ({
  header,
  expectedSecret,
  failureLogKey,
}: SecretHeaderAuthOptions) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const provided = req.headers[header] as string | undefined;

    if (!expectedSecret) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!provided) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    try {
      const expectedBuf = Buffer.from(expectedSecret, 'utf8');
      const providedBuf = Buffer.from(provided, 'utf8');

      if (
        expectedBuf.length !== providedBuf.length ||
        !crypto.timingSafeEqual(expectedBuf, providedBuf)
      ) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      next();
    } catch (error) {
      // Usually a malformed header or a misconfigured secret — without this log
      // that is indistinguishable from an auth attack.
      logger.error(failureLogKey, { error });
      res.status(401).json({ error: 'Unauthorized' });
    }
  };
};
