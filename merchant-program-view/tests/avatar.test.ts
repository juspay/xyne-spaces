import { describe, expect, it } from 'vitest';
import { avatarColors, avatarInitial } from '../lib/avatar';

// Expected colours from the dashboard's getAvatarColorClassNames (Avatar.tsx), Tailwind default hexes.
describe('avatarColors', () => {
  it('picks the same palette entry as the Xyne dashboard, from the user id', () => {
    expect(avatarColors('u1')).toEqual({ bg: '#c084fc', fg: '#ffffff' }); // purple-400
    expect(avatarColors('cmjkaa1b2c3d')).toEqual({ bg: '#5eead4', fg: '#ffffff' }); // teal-300
    expect(avatarColors('a-very-long-user-id-0123456789-abcdefghijklmnop')).toEqual({ bg: '#5eead4', fg: '#ffffff' });
  });
  it('uses the muted entry (grey on light grey) where the dashboard does, and for a missing id', () => {
    expect(avatarColors('cmohfuhfz0n57zc594ycoueg7')).toEqual({ bg: 'var(--bg3)', fg: 'var(--t3)' });
    expect(avatarColors('')).toEqual({ bg: 'var(--bg3)', fg: 'var(--t3)' });
  });
});

describe('avatarInitial', () => {
  it('is the first letter of the name, upper-cased, like the dashboard', () => {
    expect(avatarInitial('genius Reply')).toBe('G');
    expect(avatarInitial('  Saumya Jain')).toBe('S');
    expect(avatarInitial('')).toBe('');
  });
});
