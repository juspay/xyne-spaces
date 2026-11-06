import { Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { logger, loggerContext, LogContext } from '@/utils/logger';
import { CustomRequest } from '@/types/express';
import { logUrl } from '@/utils/logUrl';


export const requestLogger = (req: CustomRequest, res: Response, next: NextFunction): void => {
  // x-device-id is the persistent device key (renamed from x-client-session-id);
  // the legacy header is still honoured while old clients roll over.
  const deviceId = (req.headers['x-device-id'] as string) || undefined;
  const legacyClientSessionId = (req.headers['x-client-session-id'] as string) || undefined;

  const context: LogContext = {
    requestId: (req.headers['x-request-id'] as string) || uuidv4(),
    zeroClientId: (req.headers['x-client-id'] as string) || undefined,
    zeroClientGroupId: (req.headers['x-zero-client-group-id'] as string) || req.get('x-zero-client-group-id') || undefined,
    emailId: req.headers['x-user-email'] as string,
    clientSessionId: deviceId || legacyClientSessionId,
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
      url: logUrl(req.originalUrl),
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      clientPlatform: (req.headers['x-platform'] as string) || undefined,
      deviceIdPresent: !!deviceId,
      legacyClientSessionIdPresent: !!legacyClientSessionId,
    });

    res.on('finish', () => {
      const duration = Date.now() - startTime;
      logger.info('Request end', {
        type: 'REQUEST_END',
        method: req.method,
        url: logUrl(req.originalUrl),
        statusCode: res.statusCode,
        duration: `${duration}ms`,
        contentLength: res.get('Content-Length') || 0,
      });
    });
    next();
  });
};