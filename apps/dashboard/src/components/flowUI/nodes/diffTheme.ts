import type { Theme } from '../../../hooks/useTheme';

export const getDiffThemeType = (theme: Theme): 'dark' | 'light' => {
  if (theme === 'midnight') return 'dark';
  if (typeof document === 'undefined') return 'light';

  const root = document.documentElement;
  if (root.getAttribute('data-theme') === 'midnight') return 'dark';

  const styles = getComputedStyle(root);
  const background = styles.getPropertyValue('--background').trim();
  const lightness = /(\d+(?:\.\d+)?)%\s*$/.exec(background)?.[1];
  if (lightness !== undefined) {
    return Number(lightness) < 50 ? 'dark' : 'light';
  }

  if (styles.colorScheme.split(/\s+/).includes('dark')) return 'dark';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};
