import { Request } from 'express';

export const TELEPRESENCE_DEVICE_TYPES = ['TV', 'CAMERA', 'MICROPHONE', 'SPEAKER'] as const;

export const TELEPRESENCE_HEALTH_STATUSES = ['HEALTHY', 'DEGRADED', 'UNAVAILABLE', 'UNKNOWN'] as const;

export function extractS2SApiKey(req: Request): string | undefined {
  const headerValue = req.headers['x-s2s-key'];
  if (typeof headerValue === 'string' && headerValue.trim()) {
    return headerValue.trim();
  }

  return undefined;
}
