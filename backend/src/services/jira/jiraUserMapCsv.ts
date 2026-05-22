import { readFile } from 'fs/promises';
import { config } from '@/config/env';
import { GCSService } from '@/services/gcsService';
import { logger } from '@/utils/logger';

const USER_MAP_TTL_MS = 15 * 60 * 1000;

export type ManualUserEmailMapping = Record<string, string>;

type UserMapCache = {
  location: string;
  loadedAtMs: number;
  map: ManualUserEmailMapping;
};

let cache: UserMapCache | null = null;
let inflight: Promise<ManualUserEmailMapping> | null = null;

const normalizeHeader = (value: string): string => value.trim().toLowerCase();

const parseGsLocation = (value: string): { bucket: string; objectPath: string } | null => {
  if (!value.startsWith('gs://')) return null;
  const withoutPrefix = value.slice('gs://'.length);
  const firstSlash = withoutPrefix.indexOf('/');
  if (firstSlash <= 0) return null;
  const bucket = withoutPrefix.slice(0, firstSlash);
  const objectPath = withoutPrefix.slice(firstSlash + 1);
  if (!bucket || !objectPath) return null;
  return { bucket, objectPath };
};

export const parseJiraUserMapCsv = (csvText: string): ManualUserEmailMapping => {
  const lines = (csvText || '').split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length == 0) return {};

  const headerCells = lines[0].split(',').map(normalizeHeader);
  const emailIdx = headerCells.findIndex(cell => cell === 'email');
  const accountIdx = headerCells.findIndex(cell => cell === 'jira_account_id');

  if (emailIdx === -1 || accountIdx === -1) {
    logger.warn('[jira-migration][user-map] Invalid CSV header; expected columns email,jira_account_id');
    return {};
  }

  const map: ManualUserEmailMapping = {};
  let duplicates = 0;

  for (let i = 1; i < lines.length; i += 1) {
    const cells = lines[i].split(',');
    const rawEmail = (cells[emailIdx] || '').trim().toLowerCase();
    const rawAccountId = (cells[accountIdx] || '').trim();
    if (!rawEmail || !rawAccountId) continue;

    const key = `accountId:${rawAccountId}`;
    if (map[key]) duplicates += 1;
    map[key] = rawEmail;
  }

  if (duplicates > 0) {
    logger.warn('[jira-migration][user-map] Duplicate jira_account_id rows; last row wins', { duplicates });
  }

  return map;
};

export const loadJiraUserMapFromLocation = async (location: string): Promise<ManualUserEmailMapping> => {
  const trimmed = (location || '').trim();
  if (!trimmed) return {};

  const gs = parseGsLocation(trimmed);
  if (gs) {
    const buffer = await new GCSService(gs.bucket).getFileBuffer(gs.objectPath);
    return parseJiraUserMapCsv(buffer.toString('utf-8'));
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await fetch(trimmed);
        if (!response.ok) {
          throw new Error(`User map CSV request failed (${response.status})`);
        }
        const text = await response.text();
        return parseJiraUserMapCsv(text);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < 3) {
          await new Promise(resolve => setTimeout(resolve, 250 * attempt));
        }
      }
    }

    throw lastError || new Error('User map CSV request failed');
  }

  const fileText = await readFile(trimmed, 'utf-8');
  return parseJiraUserMapCsv(fileText);
};

export const getCachedJiraUserEmailMappings = async (): Promise<ManualUserEmailMapping> => {
  const resolvedLocation = (config.jira.migrationUserMapCsvLocation || '').trim();
  if (!resolvedLocation) return {};

  const now = Date.now();
  if (cache && cache.location === resolvedLocation && now - cache.loadedAtMs < USER_MAP_TTL_MS) {
    return cache.map;
  }

  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const map = await loadJiraUserMapFromLocation(resolvedLocation);
      cache = { location: resolvedLocation, loadedAtMs: Date.now(), map };
      const sourceType = resolvedLocation.startsWith('gs://')
        ? 'gcs'
        : (resolvedLocation.startsWith('http://') || resolvedLocation.startsWith('https://'))
          ? 'https'
          : 'local';
      logger.info('[jira-migration][user-map] Loaded Jira user mapping CSV', { sourceType, rows: Object.keys(map).length });
      return map;
    } catch (error) {
      const sourceType = resolvedLocation.startsWith('gs://')
        ? 'gcs'
        : (resolvedLocation.startsWith('http://') || resolvedLocation.startsWith('https://'))
          ? 'https'
          : 'local';
      logger.warn('[jira-migration][user-map] Failed to load Jira user mapping CSV; continuing without mapping', {
        sourceType,
        error: error instanceof Error ? error.message : String(error),
      });
      cache = { location: resolvedLocation, loadedAtMs: Date.now(), map: {} };
      return cache.map;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
};
