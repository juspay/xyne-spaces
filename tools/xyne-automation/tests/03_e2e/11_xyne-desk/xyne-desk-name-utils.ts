import { buildRandomSuffix } from '@/fixtures/fixture-helpers';

function sanitizeNamePart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getDeskRunId(): string {
  const runId = process.env.XYNE_RUN_ID ?? 'local';
  const normalizedRunId = sanitizeNamePart(runId);
  if (!normalizedRunId) {
    throw new Error('XYNE_RUN_ID must contain at least one alphanumeric character when set');
  }

  return runId;
}

/**
 * Builds an 80-char-safe channel name with a run id and random suffix.
 * The six-character suffix keeps names stable/readable while making collisions negligible for automation runs.
 */
export function buildUniqueDeskChannelName(channelAlias: string, runId = getDeskRunId()): string {
  const normalizedAlias = sanitizeNamePart(channelAlias) || 'channel-desk';
  const normalizedRunId = sanitizeNamePart(runId) || 'local';
  const uniqueSuffix = `${normalizedRunId}-${buildRandomSuffix()}`;
  const maxAliasLength = Math.max(1, 80 - uniqueSuffix.length - 1);
  const trimmedAlias = normalizedAlias.slice(0, maxAliasLength).replace(/-+$/g, '');

  return `${trimmedAlias}-${uniqueSuffix}`;
}
