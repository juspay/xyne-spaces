import { useMemo, useSyncExternalStore } from 'react';

function subscribeToThemeAttribute(onStoreChange: () => void): () => void {
  if (typeof document === 'undefined') return () => {};
  const observer = new MutationObserver(onStoreChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  return () => observer.disconnect();
}

function getThemeAttribute(): string {
  if (typeof document === 'undefined') return 'classic';
  return document.documentElement.getAttribute('data-theme') ?? 'classic';
}

export function useDiffsTheme(): {
  theme: { light: string; dark: string };
  themeType: 'light' | 'dark';
} {
  const theme = useSyncExternalStore(subscribeToThemeAttribute, getThemeAttribute, () => 'classic');
  return useMemo(
    () => ({
      theme: { light: 'github-light', dark: 'github-dark' },
      themeType: theme === 'midnight' ? ('dark' as const) : ('light' as const),
    }),
    [theme],
  );
}
