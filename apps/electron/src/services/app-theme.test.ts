import { beforeEach, describe, expect, it, vi } from 'vitest';

const storeData = vi.hoisted(() => new Map<string, unknown>());

vi.mock('electron-log/main', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('electron-store', () => ({
  default: class {
    get(key: string): unknown {
      return storeData.get(key);
    }
    set(key: string, value: unknown): void {
      storeData.set(key, value);
    }
  },
}));

import { getAppBackgroundColor, getAppTheme, setAppTheme } from './app-theme';

describe('app theme', () => {
  beforeEach(() => {
    storeData.clear();
  });

  it('defaults to the light ground before the renderer has ever reported a theme', () => {
    expect(getAppTheme()).toBe('classic');
    expect(getAppBackgroundColor()).toBe('#ffffff');
  });

  it('accepts the light/dark pair the renderer already sends', () => {
    setAppTheme('dark');
    expect(getAppTheme()).toBe('midnight');
    expect(getAppBackgroundColor()).toBe('#1a1a1f');

    setAppTheme('light');
    expect(getAppTheme()).toBe('classic');
    expect(getAppBackgroundColor()).toBe('#ffffff');
  });

  it('accepts theme names directly', () => {
    setAppTheme('summer_breeze');
    expect(getAppTheme()).toBe('summer_breeze');
    expect(getAppBackgroundColor()).toBe('#ffffff');
  });

  it('ignores anything it does not recognise rather than storing a bad ground colour', () => {
    setAppTheme('midnight');
    setAppTheme('neon');
    setAppTheme(undefined);
    setAppTheme(42);

    expect(getAppTheme()).toBe('midnight');
  });
});
