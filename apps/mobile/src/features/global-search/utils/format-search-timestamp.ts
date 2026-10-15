/**
 * Vespa's `createdAtTimestamp` is epoch ms and preferred. The backend's
 * `metadata.timestamp` is a UTC wall-clock string with no zone marker, so it is tagged
 * as UTC before parsing or it would be read as local time. Dashboard does the same.
 */

export function formatSearchResultTimestamp(options: {
  createdAtTimestamp?: number | undefined;
  metadataTimestamp?: string | undefined;
}): string {
  const { createdAtTimestamp, metadataTimestamp } = options;

  if (typeof createdAtTimestamp === 'number' && Number.isFinite(createdAtTimestamp)) {
    const date = new Date(createdAtTimestamp);
    if (!Number.isNaN(date.getTime())) {
      return formatLocalDateTime(date);
    }
  }

  if (!metadataTimestamp) return '';

  // Backend stores UTC wall-clock via toLocaleString(..., { timeZone: 'UTC' }).
  // Append " UTC" so Date parses it as UTC (dashboard utcToIst does the same).
  const parsed = new Date(
    /(?:UTC|Z|GMT|[+-]\d{2}:?\d{2})$/i.test(metadataTimestamp.trim())
      ? metadataTimestamp
      : `${metadataTimestamp} UTC`,
  );
  if (Number.isNaN(parsed.getTime())) {
    return metadataTimestamp;
  }
  return formatLocalDateTime(parsed);
}

function formatLocalDateTime(date: Date): string {
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();

  return date.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}
