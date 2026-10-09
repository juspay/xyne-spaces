export function scopeReplyFormat(
  stored: Record<string, unknown>,
  requested: Record<string, unknown> | undefined,
  channelRun: boolean,
): Record<string, unknown> {
  const { replyFormat: _stored, ...storedRest } = stored;
  const { replyFormat, ...requestedRest } = requested ?? {};
  return {
    ...storedRest,
    ...requestedRest,
    ...(channelRun && replyFormat !== undefined ? { replyFormat } : {}),
  };
}
