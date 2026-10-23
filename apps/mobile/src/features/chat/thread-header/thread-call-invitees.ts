/** Keep the caller in the payload: an empty invitation list means the whole channel to the API. */
export function buildThreadCallInvitees(
  selected: readonly string[],
  currentUserId: string,
): string[] {
  if (!currentUserId) throw new Error('Your user details are still loading. Please try again.');
  return [...new Set([currentUserId, ...selected.filter(Boolean)])];
}

export function defaultThreadCallInvitees(
  participants: readonly {
    userId: string;
    isSubscribed?: boolean;
    participationType?: string | null;
  }[],
  currentUserId: string,
): string[] {
  return [
    ...new Set(
      participants
        .filter(p => p.isSubscribed || p.participationType != null)
        .map(p => p.userId)
        .filter(id => id !== currentUserId),
    ),
  ];
}

export function parseCallInvitees(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every(id => typeof id === 'string' && id.length > 0)
      ? [...new Set(parsed as string[])]
      : undefined;
  } catch {
    return undefined;
  }
}
