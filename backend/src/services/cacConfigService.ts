import { superpositionClient, type SuperpositionContext } from '@/services/superpositionClient';
import { logger } from '@/utils/logger';

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
        return JSON.parse(rawValue) as unknown;
      }
      return rawValue;
    } catch (error) {
      logger.error(`[CacConfigService] Error fetching ${key} from CAC:`, error);
      return null;
    }
  }
}
