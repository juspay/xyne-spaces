/**
 * Date Parser Utility for Search Filters
 *
 * Parses various date formats into timestamps for before/after/on filters.
 * Supported formats:
 * - ISO: YYYY-MM-DD (e.g., "2024-01-15")
 * - dd/mm/yy: (e.g., "15/01/24")
 * - dd/mm/yyyy: (e.g., "15/01/2024")
 * - dd mon yy: (e.g., "15 jan 24")
 * - dd mon yyyy: (e.g., "15 jan 2024")
 */

import { parseTimeKeywords } from './timeKeywordParser';

/**
 * Month name to number mapping (0-indexed for JavaScript Date)
 */
const MONTH_NAMES: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
};

/**
 * Apply start or end of day boundary to a date
 */
function applyBoundary(date: Date, boundary: 'start' | 'end'): number {
  if (boundary === 'start') {
    date.setUTCHours(0, 0, 0, 0);
  } else {
    date.setUTCHours(23, 59, 59, 999);
  }
  return date.getTime();
}

/**
 * Parse date string to timestamp
 * Supports ISO (YYYY-MM-DD), dd/mm/yy, dd/mm/yyyy, dd mon yy, dd mon yyyy formats
 *
 * @param dateStr - Date string to parse
 * @param boundary - Whether to return start or end of day timestamp
 * @returns Timestamp in milliseconds or null if parsing failed
 */
export function parseDateToTimestamp(dateStr: string, boundary: 'start' | 'end'): number | null {
  const trimmedValue = dateStr.trim();

  // ISO date (YYYY-MM-DD)
  const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (isoDatePattern.test(trimmedValue)) {
    const date = new Date(trimmedValue);
    if (isNaN(date.getTime())) return null;
    return applyBoundary(date, boundary);
  }

  // dd/mm/yy or dd/mm/yyyy format
  const dmyPattern = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/;
  const dmyMatch = trimmedValue.match(dmyPattern);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10) - 1; // JavaScript months are 0-indexed
    let year = parseInt(dmyMatch[3], 10);
    if (year < 100) year += 2000;
    const date = new Date(Date.UTC(year, month, day));
    if (isNaN(date.getTime())) return null;
    return applyBoundary(date, boundary);
  }

  // dd mon yy or dd mon yyyy format (e.g., "15 jan 24", "15 jan 2024")
  const dMonYPattern = /^(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+(\d{2,4})$/i;
  const dMonYMatch = trimmedValue.match(dMonYPattern);
  if (dMonYMatch) {
    const day = parseInt(dMonYMatch[1], 10);
    const month = MONTH_NAMES[dMonYMatch[2].toLowerCase()];
    let year = parseInt(dMonYMatch[3], 10);
    if (year < 100) year += 2000;
    const date = new Date(Date.UTC(year, month, day));
    if (isNaN(date.getTime())) return null;
    return applyBoundary(date, boundary);
  }

  return null;
}

/**
 * Parse time keyword to timestamp range (for range filter)
 *
 * @param keyword - Time keyword like "today", "yesterday", "last 7 days"
 * @returns Time range object with from/to timestamps or null if parsing failed
 */
export function parseTimeKeyword(keyword: string): { from: number; to: number } | null {
  const parsed = parseTimeKeywords(keyword.trim());
  if (parsed.hasTimeKeyword && parsed.config?.timeRange) {
    return parsed.config.timeRange;
  }
  return null;
}
