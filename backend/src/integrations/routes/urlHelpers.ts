import { Request } from 'express';
import { config as appConfig } from '@/config/env';

export function getFrontendUrl(req?: Request): string {
  if (req) {
    const originalHost = req.headers['x-original-host'];
    if (originalHost && typeof originalHost === 'string') {
      const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
      return `${protocol}://${originalHost}`;
    }
  }
  const url = appConfig.frontendUrl;
  if (!url) throw new Error('FRONTEND_URL config is required');
  return url.trim();
}

export function getBackendUrl(req: Request): string {
  const originalHost = req.headers['x-original-host'];
  if (originalHost && typeof originalHost === 'string') {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    return `${protocol}://${originalHost}`;
  }
  return appConfig.backendUrl;
}
