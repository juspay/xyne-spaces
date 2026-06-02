import { Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { logger, loggerContext, LogContext } from '@/utils/logger';
import { redactSensitiveUrl } from '@/utils/redact';
import { CustomRequest } from '@/types/express';


export const requestLogger = (req: CustomRequest, res: Response, next: NextFunction): void => {
  const context: LogContext = {
    requestId: (req.headers['x-request-id'] as string) || uuidv4(),
    zeroClientId: (req.headers['x-client-id'] as string) || undefined,
    zeroClientGroupId: (req.headers['x-zero-client-group-id'] as string) || req.get('x-zero-client-group-id') || undefined,
    sessionId: (req.headers['x-session-id'] as string) || req.get('x-session-id') || undefined,
    emailId: req.headers['x-user-email'] as string,
    clientSessionId: req.headers['x-client-session-id'] as string || undefined,
    appVersion: (req.headers['x-app-version'] as string) || undefined,
  };
  req.requestId = context.requestId;

  loggerContext.run(context, () => {
    const startTime = Date.now();
    req.startTime = startTime;
    res.locals.requestId = context.requestId;

    logger.info('Request start', {
      type: 'REQUEST_START',
      method: req.method,
      url: redactSensitiveUrl(req.url),
      ip: req.ip,
      userAgent: req.get('User-Agent'),
    });

    res.on('finish', () => {
      const duration = Date.now() - startTime;
      logger.info('Request end', {
        type: 'REQUEST_END',
        method: req.method,
        url: redactSensitiveUrl(req.url),
        statusCode: res.statusCode,
        duration: `${duration}ms`,
        contentLength: res.get('Content-Length') || 0,
      });
    });
    next();
  });
};