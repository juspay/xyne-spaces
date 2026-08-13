import Store from 'electron-store';

export type AppTheme = 'classic' | 'midnight' | 'summer_breeze';

const store = new Store<{ theme?: AppTheme }>({ name: 'appearance' });
const THEMES: readonly AppTheme[] = ['classic', 'midnight', 'summer_breeze'];

export function isAppTheme(value: unknown): value is AppTheme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

export function getAppTheme(fallbackTheme?: unknown): AppTheme {
  const stored = store.get('theme');
  if (isAppTheme(stored)) return stored;
  if (isAppTheme(fallbackTheme)) {
    store.set('theme', fallbackTheme);
    return fallbackTheme;
  }
  return 'classic';
}

export function setAppTheme(theme: AppTheme): void {
  store.set('theme', theme);
}
