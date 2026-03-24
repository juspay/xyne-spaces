import { Request, Response, NextFunction } from 'express';

import { logger } from '../utils/logger';
import {
  getHttpRequestDuration,
  getHttpRequestTotal,
  getHttpRequestErrors,
  getActiveConnections
} from '@/services/otel';


export const metricsMiddleware = (req: Request, res: Response, next: NextFunction) => {
  
  getActiveConnections().add(1);

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

  
    getHttpRequestDuration().record(duration, {
      method,
      route,
      status_code: statusCode
    });


    getHttpRequestTotal().add(1, {
      method,
      route,
      status_code: statusCode
    });


    if (res.statusCode >= 400) {
      const errorType = res.statusCode >= 500 ? 'server_error' : 'client_error';
      getHttpRequestErrors().add(1, {
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
   getActiveConnections().add(-1);
 });

  next();
};



