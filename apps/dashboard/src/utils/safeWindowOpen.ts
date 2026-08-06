export const SAFE_WINDOW_OPEN_FEATURES = 'noopener,noreferrer';

const mergeWindowFeatures = (features?: string): string => {
  const tokens = new Set(
    features
      ?.split(',')
      .map(feature => feature.trim())
      .filter(Boolean) ?? [],
  );

  tokens.add('noopener');
  tokens.add('noreferrer');

  return Array.from(tokens).join(',');
};

export const openSafeWindow = (
  url?: string | URL,
  target = '_blank',
  features?: string,
): Window | null => window.open(url, target, mergeWindowFeatures(features));
