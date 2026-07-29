import type { ILogger } from '@xyne/vespa-ts';
import {logger} from '@/utils/logger';

// Re-export time keyword parser utilities
export {
  parseTimeKeywords,
  formatTimeRange,
  type ParsedTimeQuery,
  type TimeKeywordConfig,
  type TimeRange,
  FRESHNESS_WEIGHTS,
  RANKING_PROFILES,
} from './timeKeywordParser';

export const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  return String(error);
};

// Console fallback logger
export const consoleLogger: ILogger = {
  info: (message: string, ...args: any[]) => logger.debug(`[INFO] ${message}`, ...args),
  error: (message: string | Error, ...args: any[]) => {
    const msg = message instanceof Error ? message.message : message;
    logger.error(`[ERROR] ${msg}`, ...args);
  },
  warn: (message: string, ...args: any[]) => logger.warn(`[WARN] ${message}`, ...args),
  debug: (message: string, ...args: any[]) => logger.debug(`[DEBUG] ${message}`, ...args),
  child: () => consoleLogger,
};

export const formatYqlToReadable = (yql: string) => {
  const lines = yql
    .trim()
    // Normalize operators to have consistent spacing
    .replace(/\s+(or|and)\s+/gi, ' $1 ')
    // Add line breaks before logical operators
    .replace(/\s+(OR|or)\s+/gi, '\n OR ')
    .replace(/\s+(AND|and)\s+/gi, '\n AND ')
    // Handle parentheses - add breaks after opening and before closing
    .replace(/\(/g, '(\n')
    .replace(/\)/g, '\n)')
    .split('\n')
    .filter((line) => line.trim() !== ''); // Remove empty lines

  let indentLevel = 0;
  const indentSize = 2;

  return lines
    .map((line) => {
      const trimmed = line.trim();

      // Decrease indent for closing parentheses
      if (trimmed.startsWith(')')) {
        indentLevel = Math.max(0, indentLevel - 1);
      }

      const indentedLine = ' '.repeat(indentLevel * indentSize) + trimmed;

      // Increase indent for opening parentheses
      if (trimmed.endsWith('(')) {
        indentLevel++;
      }

      return indentedLine;
    })
    .join('\n');
};
