import { Request, Response, NextFunction } from 'express';

import { logger } from '../utils/logger';
import {
  httpRequestDuration,
  httpRequestTotal,
  httpRequestErrors,
  activeConnections
} from '@/services/otel';


export const metricsMiddleware = (req: Request, res: Response, next: NextFunction) => {
  
  activeConnections.add(1);

  const start = Date.now();

  
  res.on('finish', () => {
  
    const duration = Date.now() - start;

  
    let route = 'unknown';
    
    if (req.route) {
     
      const basePath = req.baseUrl || '';
      const routePath = req.route.path || '';
      route = `${basePath}${routePath}`;
    } else {
      
      route = 'unmatched route';
    }

    const method = req.method;
    const statusCode = res.statusCode.toString();

  
    httpRequestDuration.record(duration, {
      method,
      route,
      status_code: statusCode
    });


    httpRequestTotal.add(1, {
      method,
      route,
      status_code: statusCode
    });


    if (res.statusCode >= 400) {
      const errorType = res.statusCode >= 500 ? 'server_error' : 'client_error';
      httpRequestErrors.add(1, {
        method,
        route,
        status_code: statusCode,
        error_type: errorType
      });
    }

    if (duration > 1000) {
      logger.warn(`Slow request: ${method} ${route} took ${duration}ms`);
    }
  });

  res.on('close', () => {
   activeConnections.add(-1);
 });

  next();
};



