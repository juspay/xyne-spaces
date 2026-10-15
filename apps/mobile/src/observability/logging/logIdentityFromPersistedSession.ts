export type PersistedLogIdentity = Readonly<{
  userId: string;
  email: string;
  workspaceId?: string;
}>;

/**
 * Builds logger identity from the persisted MMKV session. Headless Android
 * FCM and the iOS Notification Service Extension emit before AuthContext
 * mounts, so email must come from this cache.
 */
export function logIdentityFromPersistedSession(
  userId: string | null,
  userCacheJson: string | null,
): PersistedLogIdentity | null {
  const trimmedUserId = userId?.trim() ?? '';
  if (!trimmedUserId || !userCacheJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(userCacheJson) as Partial<{
      user_id: string;
      email: string;
      workspaceId: string;
    }>;

    if (parsed.user_id !== trimmedUserId) {
      return null;
    }

    const email = typeof parsed.email === 'string' ? parsed.email.trim() : '';
    if (!email) {
      return null;
    }

    const workspaceId = typeof parsed.workspaceId === 'string' ? parsed.workspaceId.trim() : '';

    return {
      userId: trimmedUserId,
      email,
      ...(workspaceId ? { workspaceId } : {}),
    };
  } catch {
    return null;
  }
}
