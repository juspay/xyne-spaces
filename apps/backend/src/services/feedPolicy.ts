/** Pure policy shared by the REST handlers and their tests. */
export function canReadFeedSource(
  channel: { workspaceId: string; visibility: string; scopeType: string },
  workspaceId: string,
  participant: boolean
): boolean {
  return (
    channel.workspaceId === workspaceId &&
    (participant || (channel.visibility === 'PUBLIC' && channel.scopeType === 'DEFAULT'))
  );
}
export function validSelection(ids: unknown): ids is string[] {
  return (
    Array.isArray(ids) &&
    ids.length <= 10 &&
    ids.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 200) &&
    new Set(ids).size === ids.length
  );
}
export function parseFeedRange(
  header: string | undefined,
  size: number
): { start: number; end: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || size < 1) throw new Error('Invalid range');
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start > end ||
    start >= size
  )
    throw new Error('Invalid range');
  return { start, end };
}
