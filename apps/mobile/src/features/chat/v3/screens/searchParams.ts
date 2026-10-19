/** Coerce Expo `useLocalSearchParams` into the L1 raw-params object. */
export const recordFromSearchParams = (
  params: Record<string, unknown>,
): Record<string, unknown> => {
  const raw: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      raw[key] = value;
    }
  }
  return raw;
};

export const ticketThreadRaw = ({
  channelId,
  threadId,
  ticketId,
  messageId,
  from,
  createdAt,
  source,
}: {
  channelId: string;
  threadId: string;
  ticketId: string;
  messageId?: string;
  from?: string;
  createdAt?: string | number;
  source?: string;
}): Record<string, unknown> => ({
  channelId,
  threadId,
  ticketId,
  ...(messageId ? { messageId } : {}),
  ...(from ? { from } : {}),
  ...(source ? { source } : {}),
  ...(createdAt !== undefined && String(createdAt).length > 0
    ? { createdAt: String(createdAt) }
    : {}),
});
