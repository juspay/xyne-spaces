import { useCSSVariable } from 'uniwind';

const PALETTE_SIZE = 12;

const hash = (s: string): number => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

const getUserColorIndex = (userId: string): number => {
  if (!userId) return 0;
  return hash(userId) % PALETTE_SIZE;
};

export const useUserColor = (userId: string): string => {
  const c1 = useCSSVariable('--color-username-1') as string;
  const c2 = useCSSVariable('--color-username-2') as string;
  const c3 = useCSSVariable('--color-username-3') as string;
  const c4 = useCSSVariable('--color-username-4') as string;
  const c5 = useCSSVariable('--color-username-5') as string;
  const c6 = useCSSVariable('--color-username-6') as string;
  const c7 = useCSSVariable('--color-username-7') as string;
  const c8 = useCSSVariable('--color-username-8') as string;
  const c9 = useCSSVariable('--color-username-9') as string;
  const c10 = useCSSVariable('--color-username-10') as string;
  const c11 = useCSSVariable('--color-username-11') as string;
  const c12 = useCSSVariable('--color-username-12') as string;

  const palette = [c1, c2, c3, c4, c5, c6, c7, c8, c9, c10, c11, c12];
  return palette[getUserColorIndex(userId)] ?? c1;
};
