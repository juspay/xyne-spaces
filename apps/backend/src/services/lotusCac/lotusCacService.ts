import { logger } from '@/utils/logger';
import { lotusSuperpositionClient } from './lotusSuperpositionClient';
import type {
  LotusCacContext,
  LotusCacFetchAllResult,
  LotusCacFetchResult,
  ResolvedLotusConfig,
} from './types';

/**
 * Turn Express query (or any bag) into a flat string context for Superposition.
 * - Drops reserved `email` (server injects it)
 * - Coerces values to strings
 * - Skips empty / non-scalar values
 */
export function buildLotusContext(
  raw: Record<string, unknown> | undefined,
  userEmail?: string | null
): LotusCacContext {
  const context: LotusCacContext = {};

  if (raw) {
    for (const [key, value] of Object.entries(raw)) {
      if (key === 'email') continue; // never trust client email
      if (value === undefined || value === null) continue;
      // Express query can be string | string[]; take first if array
      const scalar = Array.isArray(value) ? value[0] : value;
      if (typeof scalar === 'object') continue;
      const str = String(scalar).trim();
      if (!str) continue;
      context[key] = str;
    }
  }

  if (userEmail) {
    context.email = userEmail;
  }

  return context;
}

function parseConfigValue(raw: unknown): unknown {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return raw;
    }
  }
  return raw;
}

function parseAllConfigValues(all: ResolvedLotusConfig): ResolvedLotusConfig {
  const configs: ResolvedLotusConfig = {};
  for (const [key, value] of Object.entries(all)) {
    configs[key] = parseConfigValue(value);
  }
  return configs;
}

export class LotusCacService {
  public static async fetch(
    key: string,
    clientDimensions: Record<string, unknown> | undefined,
    userEmail?: string | null
  ): Promise<LotusCacFetchResult | { error: string; status: number }> {
    if (!key?.trim()) {
      return { error: 'Config key is required', status: 400 };
    }

    const context = buildLotusContext(clientDimensions, userEmail);

    try {
      const all = await lotusSuperpositionClient.resolveConfig(context);
      return {
        key,
        config: parseConfigValue(all[key]),
      };
    } catch (error) {
      logger.error('[LotusCacService] fetch failed', { key, context, error });
      return { error: 'Failed to resolve lotus config', status: 502 };
    }
  }

  /** Resolve every default-config key for the given dimension context. */
  public static async fetchAll(
    clientDimensions: Record<string, unknown> | undefined,
    userEmail?: string | null
  ): Promise<LotusCacFetchAllResult | { error: string; status: number }> {
    const context = buildLotusContext(clientDimensions, userEmail);

    try {
      const all = await lotusSuperpositionClient.resolveConfig(context);
      return { configs: parseAllConfigValues(all) };
    } catch (error) {
      logger.error('[LotusCacService] fetchAll failed', { context, error });
      return { error: 'Failed to resolve lotus configs', status: 502 };
    }
  }
}
