import { useCSSVariable } from 'uniwind';

const PALETTE_SIZE = 12;

// The 12 username-color CSS variables, ordered. Kept as a single tuple so the
// palette can be read in ONE `useCSSVariable` array call instead of 12 hooks
// (each hook registers two synchronous layout-effect subscriptions on mount —
// expensive when multiplied across every visible row during a channel open).
export const USERNAME_COLOR_VAR_NAMES = [
  '--color-username-1',
  '--color-username-2',
  '--color-username-3',
  '--color-username-4',
  '--color-username-5',
  '--color-username-6',
  '--color-username-7',
  '--color-username-8',
  '--color-username-9',
  '--color-username-10',
  '--color-username-11',
  '--color-username-12',
] as const;

const hash = (s: string): number => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

export const getUserColorIndex = (userId: string): number => {
  if (!userId) return 0;
  return hash(userId) % PALETTE_SIZE;
};

// Resolve a sender color from an already-read palette (no hooks). Use this on the
// chat render-token path so rows pay zero per-row CSS-variable subscriptions.
export const colorFromUsernamePalette = (palette: readonly string[], userId: string): string =>
  palette[getUserColorIndex(userId)] ?? palette[0] ?? '';

// Hook variant for components rendered outside the chat render-token context
// (user details, forwarded headers). Reads the whole palette in one array call.
export const useUserColor = (userId: string): string => {
  const palette = useCSSVariable(USERNAME_COLOR_VAR_NAMES as unknown as string[]) as string[];
  return colorFromUsernamePalette(palette, userId);
};
