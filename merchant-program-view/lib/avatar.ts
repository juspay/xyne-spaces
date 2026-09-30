/**
 * Avatar fallbacks as the Xyne dashboard draws them (components/ui/Avatar/Avatar.tsx): one letter, on a
 * colour picked from the user id with the same hash and palette (Tailwind's default hexes).
 */

const WHITE = '#ffffff';
const MUTED = { bg: 'var(--bg3)', fg: 'var(--t3)' };

// Same order as the dashboard's palette; null is its bg-muted entry.
const PALETTE: (string | null)[] = [
  '#f87171', // red-400
  '#2dd4bf', // teal-400
  '#38bdf8', // sky-400
  '#fdba74', // orange-300
  '#86efac', // green-300
  '#fde047', // yellow-300
  '#d8b4fe', // purple-300
  '#93c5fd', // blue-300
  '#fbbf24', // amber-400
  '#22c55e', // green-500
  '#f472b6', // pink-400
  '#818cf8', // indigo-400
  '#10b981', // emerald-500
  '#eab308', // yellow-500
  '#ea580c', // orange-600
  '#60a5fa', // blue-400
  '#c084fc', // purple-400
  '#fb7185', // rose-400
  '#06b6d4', // cyan-500
  '#f87171', // red-400
  '#5eead4', // teal-300
  '#f9a8d4', // pink-300
  null, // muted
  '#4ade80', // green-400
  '#fb923c', // orange-400
  '#a78bfa', // violet-400
  '#dc2626', // red-600
  '#2563eb', // blue-600
  '#059669', // emerald-600
  '#f97316', // orange-500
];

export function avatarColors(userId: string): { bg: string; fg: string } {
  if (!userId) return MUTED;
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  const bg = PALETTE[Math.abs(hash) % PALETTE.length];
  return bg ? { bg, fg: WHITE } : MUTED;
}

export function avatarInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase();
}
