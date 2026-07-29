export function sanitizeReturnPath(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined;
  if (!input.startsWith('/')) return undefined;
  if (input.startsWith('//')) return undefined;
  if (input.includes('\\')) return undefined;
  if (/[\r\n]/.test(input)) return undefined;
  return input;
}

export function buildSupportPath(
  workspaceId: string | undefined,
  channelId: string | undefined,
  query: URLSearchParams,
): string {
  const queryString = query.toString();
  const wsSegment = workspaceId ? `/${workspaceId}` : '';
  const channelSegment = channelId ? `/${channelId}` : '';
  const suffix = queryString ? `?${queryString}` : '';
  return `${wsSegment}/support${channelSegment}${suffix}`;
}

export function appendQueryToReturnPath(
  returnPath: string,
  query: URLSearchParams,
): string {
  const separator = returnPath.includes('?') ? '&' : '?';
  return `${returnPath}${separator}${query.toString()}`;
}

export function buildReturnPathOrSupportPath(
  returnPath: string | undefined,
  workspaceId: string | undefined,
  channelId: string | undefined,
  query: URLSearchParams,
): string {
  if (returnPath) {
    return appendQueryToReturnPath(returnPath, query);
  }
  return buildSupportPath(workspaceId, channelId, query);
}
