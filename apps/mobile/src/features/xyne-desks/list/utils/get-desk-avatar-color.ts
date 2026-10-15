import { DESK_AVATAR_COLORS } from '../constants';

/** Stable color from id/name — same letter → same color across paints. */
export function getDeskAvatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  return DESK_AVATAR_COLORS[Math.abs(hash) % DESK_AVATAR_COLORS.length]!;
}

export function getDeskInitial(name: string): string {
  const trimmed = name.trim();
  return (trimmed[0] ?? '?').toUpperCase();
}
