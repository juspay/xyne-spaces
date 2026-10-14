/**
 * §8.1 reuse gate: **Refactor-then-adopt**. Characterised against v2
 * `getUserColorIndex` / `colorFromUsernamePalette`. The `useUserColor` hook
 * (uniwind) stays out of the model layer.
 */

const PALETTE_SIZE = 12;

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

export const colorFromUsernamePalette = (palette: readonly string[], userId: string): string =>
  palette[getUserColorIndex(userId)] ?? palette[0] ?? '';
