import { useCallback, useEffect, useState } from 'react';
import {
  applyStoredOpacity,
  clearStoredOpacity,
  currentTheme,
  getEffectiveOpacity,
  hasStoredOpacity,
  setStoredOpacity,
  subscribeWallpaperOpacity,
} from '../stores/wallpaperOpacityStore';

export function useApplyWallpaperOpacity(): void {
  useEffect(() => {
    applyStoredOpacity(currentTheme());

    const observer = new MutationObserver(() => applyStoredOpacity(currentTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return (): void => observer.disconnect();
  }, []);
}

export function useWallpaperOpacity(): {
  theme: string;
  value: number;
  isCustom: boolean;
  setValue: (next: number) => void;
  reset: () => void;
} {
  const [theme, setTheme] = useState(currentTheme);
  const [value, setValueState] = useState(() => getEffectiveOpacity(currentTheme()));
  const [isCustom, setIsCustom] = useState(() => hasStoredOpacity(currentTheme()));

  useEffect(() => {
    const sync = (): void => {
      const next = currentTheme();
      setTheme(next);
      setValueState(getEffectiveOpacity(next));
      setIsCustom(hasStoredOpacity(next));
    };
    sync();

    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-glass', 'data-glass-tier'],
    });
    const unsubscribe = subscribeWallpaperOpacity(sync);
    return (): void => {
      observer.disconnect();
      unsubscribe();
    };
  }, []);

  const setValue = useCallback((next: number) => {
    setStoredOpacity(currentTheme(), next);
  }, []);

  const reset = useCallback(() => {
    clearStoredOpacity(currentTheme());
  }, []);

  return { theme, value, isCustom, setValue, reset };
}
