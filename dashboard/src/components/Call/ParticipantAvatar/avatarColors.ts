const AVATAR_COLOR_PAIRS: [string, string][] = [
  ['#10B981', '#0D3D2E'], // Green
  ['#F59E0B', '#3D2F0B'], // Yellow/Orange
  ['#3B82F6', '#1E3A5F'], // Blue
  ['#8B5CF6', '#2D1F4D'], // Purple
  ['#EC4899', '#4D1F35'], // Pink
  ['#06B6D4', '#0D3D44'], // Cyan
  ['#F97316', '#3D2510'], // Orange
  ['#14B8A6', '#0D3D36'], // Teal
];

// Simple hash function to deterministically select color based on identity
export function getAvatarColors(identity: string | null | undefined): {
  avatar: string;
  background: string;
} {
  const idValue = identity ?? 'unknown';
  let hash = 0;
  for (let i = 0; i < idValue.length; i++) {
    hash = idValue.charCodeAt(i) + ((hash << 5) - hash);
  }
  const pair = AVATAR_COLOR_PAIRS[Math.abs(hash) % AVATAR_COLOR_PAIRS.length] as [string, string];
  return { avatar: pair[0], background: pair[1] };
}
