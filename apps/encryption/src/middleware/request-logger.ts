import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from '@/config/env';
import { logger, loggerContext, type LogContext } from '@/utils/logger';

const debugEnabled = config.logging.level === 'debug';

type RequestWithTiming = Request & {
  requestId?: string;
  startTime?: number;
};

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function requestPath(req: Request): string {
  return req.path || req.url.split('?', 1)[0] || '/';
}

export function requestLogger(req: RequestWithTiming, res: Response, next: NextFunction): void {
  const path = requestPath(req);
  if (path === '/health') {
    next();
    return;
  }

  const context: LogContext = {
    requestId: firstHeader(req.headers['x-request-id']) || crypto.randomUUID(),
    zeroClientId: firstHeader(req.headers['x-client-id']),
    zeroClientGroupId: firstHeader(req.headers['x-zero-client-group-id']),
    emailId: firstHeader(req.headers['x-user-email']),
    clientSessionId: firstHeader(req.headers['x-client-session-id']),
    appVersion: firstHeader(req.headers['x-app-version']),
  };

  req.requestId = context.requestId;

  loggerContext.run(context, () => {
    const startTime = Date.now();
    req.startTime = startTime;
    res.locals.requestId = context.requestId;

    if (debugEnabled) {
      logger.debug('Request start', {
        type: 'REQUEST_START',
        method: req.method,
        path,
      });
    }

    res.on('finish', () => {
      logger.info('Request end', {
        type: 'REQUEST_END',
        method: req.method,
        path,
        statusCode: res.statusCode,
        durationMs: Date.now() - startTime,
        contentLength: res.getHeader('content-length') || 0,
      });
    });

    res.on('close', () => {
      if (!res.writableEnded) {
        logger.warn('Request closed before response completed', {
          type: 'REQUEST_ABORTED',
          method: req.method,
          path,
          durationMs: Date.now() - startTime,
        });
      }
    });

    res.on('error', (error) => {
      logger.error('Response error', {
        type: 'RESPONSE_ERROR',
        method: req.method,
        path,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    next();
  });
}
