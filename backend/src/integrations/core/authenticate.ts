/**
 * Authentication middleware
 * Platform-agnostic authentication framework
 */

import { Request, Response, NextFunction } from 'express';
import { ExternalSource } from '@prisma/client';
import { logger } from '../../utils/logger';
import { ExternalSourceRepository } from '../../database/repositories/externalSourceRepository';
import { decrypt, encrypt } from '../../services/encryptionService';
import { config } from '@/config/env';
import { RawBodyRequest } from '../../types/express';

const externalSourceRepository = new ExternalSourceRepository();

// Extend Express Request to include source-specific properties
declare module 'express-serve-static-core' {
  interface Request {
    sourceName?: string;
    source?: ExternalSource;
  }
}

/**
 * Express middleware to authenticate requests
 * Uses adapter.authenticate() method
 *
 * Usage:
 *   router.post('/external-source-sync/:sourceName', adapterResolver, authenticate, controller)
 */
export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void | Response> {
  try {
    const { sourceName } = req.params;
    const rawBodyReq = req as RawBodyRequest;

    const adapter = rawBodyReq.adapter;
    if (!adapter) {
      res.status(500).json({
        error: 'Adapter not resolved',
      });
      return;
    }

    if (adapter.isTestPayload) {
      const testPayloadResult = adapter.isTestPayload(rawBodyReq.body);
      if (testPayloadResult.isTest && testPayloadResult.response) {
        res.status(testPayloadResult.response.status).json(testPayloadResult.response.body);
        return;
      }
    }
    const resolvedSourceName = adapter.getSourceNameFromDB?.(rawBodyReq.body) || sourceName;

    let source = await externalSourceRepository.findByName(resolvedSourceName);
    if (!source && sourceName === 'google') {
      try {
        const message = rawBodyReq.body?.message;
        const encodedData = typeof message?.data === 'string' ? message.data : '';
        if (encodedData) {
          const decoded = Buffer.from(encodedData, 'base64').toString('utf-8');
          const parsed = JSON.parse(decoded) as { emailAddress?: string };
          if (parsed.emailAddress) {
            source = await externalSourceRepository.findGoogleSourceByDisplayEmail(
              parsed.emailAddress,
            );
          }
        }
      } catch (error) {
        logger.warn('Failed Google source fallback by display email', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (!source) {
      logger.warn(
        `Sync request received for unknown source: ${resolvedSourceName} (route: ${sourceName})`
      );
      res.status(200).json({
        success: true,
        skipped: true,
        reason: 'unknown_source',
        sourceName: resolvedSourceName,
      });
      return;
    }

    if (!source.isActive) {
      logger.warn(
        `Skipping ingest for disconnected source: ${resolvedSourceName} (isActive=false)`,
      );
      res.status(504).json({
        success: false,
        skipped: true,
        reason: 'inactive_source',
        sourceName: resolvedSourceName,
      });
      return;
    }

    // Decrypt credentials from database
    let decryptedCredentials: string;
    try {
      decryptedCredentials = decrypt(source.credentials);
    } catch (error) {
      logger.error(`Failed to decrypt credentials for source: ${resolvedSourceName}`, error);
      res.status(500).json({
        error: 'Server configuration error',
        hint: 'Failed to decrypt credentials',
      });
      return;
    }

    // Use raw body string (preserved by express.json() verify callback in app.ts)
    // This is the EXACT original string Slack sent (before any parsing)
    const rawBody = rawBodyReq.rawBody;

    // Authenticate using adapter
    // Pass exact raw string for HMAC verification
    const authResult = await adapter.authenticate(
      rawBody,
      rawBodyReq.headers as Record<string, string | string[]>,
      decryptedCredentials,
      resolvedSourceName
    );

    if (!authResult.authenticated) {
      logger.warn(`Authentication failed for source: ${resolvedSourceName}`);
      res.status(401).json({
        error: 'Authentication failed',
        hint: 'Invalid signature or JWT',
      });
      return;
    }

    const observedClientState = authResult.metadata?.clientState;
    if (observedClientState && config.microsoftGraph.clientStateBackfillEnabled) {
      try {
        const credentials = JSON.parse(decryptedCredentials) as { clientState?: string; [key: string]: unknown };
        if (!credentials.clientState) {
          credentials.clientState = observedClientState;
          const encryptedCredentials = encrypt(JSON.stringify(credentials));
          await externalSourceRepository.update(source.id, {
            credentials: encryptedCredentials,
          });
          source.credentials = encryptedCredentials;
          logger.info(`Backfilled Microsoft clientState for source: ${resolvedSourceName}`);
        }
      } catch (error) {
        logger.warn(`Failed to backfill Microsoft clientState for source: ${resolvedSourceName}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Check if processing should be skipped (e.g., test webhooks)
    if (authResult.skipProcessing) {
      logger.info(
        `Skipping processing for ${resolvedSourceName}: ${authResult.reason || 'no reason provided'}`
      );
      res.status(200).json({
        success: true,
        skipped: true,
        reason: authResult.reason,
      });
      return;
    }

    // Pass resolved source name and source object to downstream processing
    req.sourceName = resolvedSourceName;
    req.source = source;

    logger.info(`Authenticated source: ${resolvedSourceName}`);
    next();
  } catch (error) {
    logger.error('Authentication error:', error);
    res.status(500).json({
      error: 'Authentication failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
