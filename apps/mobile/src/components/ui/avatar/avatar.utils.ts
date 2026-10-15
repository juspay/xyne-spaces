import { useSelector } from '@xstate/react';

import { API_BASE_URL } from '@/src/config';
import { stateMachineActor, type User } from '@/src/machines/stateMachine';

const ACCENT_COLORS = [
  '#6B4EFF',
  '#219aef',
  '#9B59B6',
  '#5AC8FA',
  '#34C759',
  '#FF9500',
  '#FF3B30',
  '#AF52DE',
  '#FF2D55',
  '#32ADE6',
  '#5856D6',
  '#00C7BE',
] as const;

export function isHttpUrl(value: string | null | undefined): value is string {
  return !!value && /^https?:\/\//i.test(value);
}

/**
 * Mirrors dashboard useProfilePictureUrl:
 * - absolute URL → use directly
 * - storage path (profile-pictures/..., attachments/...) → authenticated stream endpoint
 */
export function resolveProfilePictureRequestUrl(userId: string, picturePath: string): string {
  if (isHttpUrl(picturePath)) {
    return picturePath;
  }

  const cacheParam = encodeURIComponent(picturePath);
  return `${API_BASE_URL}/users/${userId}/picture?v=${cacheParam}`;
}

export function getInitials(name: string | null | undefined): string {
  const trimmed = name?.trim();
  if (!trimmed) return '?';

  return Array.from(trimmed)[0]?.toUpperCase() ?? '?';
}

export function getAvatarAccentColor(userId: string): string {
  if (!userId) return ACCENT_COLORS[0];

  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }

  return ACCENT_COLORS[Math.abs(hash) % ACCENT_COLORS.length]!;
}

export function sanitizeCacheKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function userSnapshotEqual(a: User | undefined, b: User | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;

  return (
    a.id === b.id && a.name === b.name && a.displayName === b.displayName && a.picture === b.picture
  );
}

/** Narrow xstate subscription — avoids re-rendering all avatars on unrelated user updates. */
export function useUserSnapshot(userId: string): User | undefined {
  return useSelector(
    stateMachineActor,
    state => state.context.users.find(user => user.id === userId),
    userSnapshotEqual,
  );
}
