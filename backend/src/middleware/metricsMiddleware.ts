import { Request, Response, NextFunction } from 'express';

import { logger } from '../utils/logger';
import { metrics } from '@/services/otel/pull/metrics';


export const metricsMiddleware = (req: Request, res: Response, next: NextFunction) => {
  
  metrics.activeConnections.inc();

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

  
    metrics.httpRequestDuration
      .labels(method, route, statusCode)
      .observe(duration);


    metrics.httpRequestTotal
      .labels(method, route, statusCode)
      .inc();


    if (res.statusCode >= 400) {
      const errorType = res.statusCode >= 500 ? 'server_error' : 'client_error';
      metrics.httpRequestErrors
        .labels(method, route, statusCode, errorType)
        .inc();
    }

 
  


    if (duration > 1000) {
      logger.warn(`Slow request: ${method} ${route} took ${duration}ms`);
    }
  });
  res.on('close', () => {
   metrics.activeConnections.dec();
 });

  next();
};



