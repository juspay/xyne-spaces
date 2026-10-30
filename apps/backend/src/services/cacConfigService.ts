import type { Request } from 'express';
import { superpositionClient, type SuperpositionContext } from '@/services/superpositionClient';
import { logger } from '@/utils/logger';

/** Superposition context for a request: email, workspaceId, and environment for pre-prod. */
export function cacContextFromRequest(req: Request): SuperpositionContext {
  const email = req.user?.email?.trim();
  const workspaceId = req.user?.workspaceId;
  const isPlayground = req.get('x-route-env')?.trim().toLowerCase() === 'playground';
  return {
    ...(email ? { email } : {}),
    ...(workspaceId ? { workspaceId } : {}),
    ...(isPlayground ? { environment: 'playground' } : {}),
  };
}

export class CacConfigService {
  public static async fetch(key: string, context?: SuperpositionContext): Promise<unknown | null> {
    try {
      const allConfigs = await superpositionClient.resolveAllConfigDetails(context);
      const entry = allConfigs[key];
      if (entry === undefined || entry === null) return null;

      const rawValue = typeof entry === 'object' && entry !== null && 'value' in entry
        ? (entry.value as unknown)
        : entry;

      if (rawValue === undefined || rawValue === null) return null;
      if (typeof rawValue === 'string') {
        // JSON.parse expects a JSON-formatted string. A URL like "https://app.example.org" is not valid JSON:
        try {
          return JSON.parse(rawValue) as unknown;
        } catch {
          return rawValue;
        }
      }
      return rawValue;
    } catch (error) {
      logger.error(`[CacConfigService] Error fetching ${key} from CAC:`, error);
      return null;
    }
  }
}
