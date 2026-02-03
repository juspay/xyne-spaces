import { useEffect, useMemo, useState } from 'react';
import { detectReactNativeWebView } from '../utils/reactNativeBridge';

export interface UsePlatformReturn {
  platform: Platform;
  isWeb: boolean;
  isElectron: boolean;
  isMobile: boolean;
  isMac: boolean;
}

/**
 * Check if the user is on mobile Firefox.
 *
 * Returns `undefined` in non-browser environments (e.g. SSR).
 */
export function isMobileFirefox(): boolean | undefined {
  if (typeof window === 'undefined' || typeof window.navigator === 'undefined') {
    return undefined;
  }

  const userAgent = window.navigator.userAgent || '';
  return (
    (/Firefox/.test(userAgent) && /Mobile/.test(userAgent)) || // Android Firefox
    /FxiOS/.test(userAgent) // iOS Firefox
  );
}

/**
 * Test the current `navigator.platform` with a regex.
 *
 * Returns `undefined` in non-browser environments (e.g. SSR).
 */
export function testPlatform(re: RegExp): boolean | undefined {
  return typeof window !== 'undefined' && typeof window.navigator !== 'undefined'
    ? re.test(window.navigator.platform)
    : undefined;
}

/**
 * Detect if the current platform is macOS.
 *
 * Returns `undefined` in non-browser environments (e.g. SSR).
 */
export function isMac(): boolean | undefined {
  return testPlatform(/^Mac/);
}

/**
 * Detect if the current platform is an iPhone.
 *
 * Returns `undefined` in non-browser environments (e.g. SSR).
 */
export function isIPhone(): boolean | undefined {
  return testPlatform(/^iPhone/);
}

/**
 * Detect if the current browser is Safari (best-effort via user agent).
 *
 * Returns `undefined` in non-browser environments (e.g. SSR).
 */
export function isSafari(): boolean | undefined {
  if (typeof window === 'undefined' || typeof window.navigator === 'undefined') {
    return undefined;
  }

  return /^((?!chrome|android).)*safari/i.test(window.navigator.userAgent || '');
}

/**
 * Detect if the current platform is an iPad.
 *
 * Returns `undefined` in non-browser environments (e.g. SSR).
 */
export function isIPad(): boolean | undefined {
  if (typeof window === 'undefined' || typeof window.navigator === 'undefined') {
    return undefined;
  }

  return (
    testPlatform(/^iPad/) ||
    // iPadOS 13 lies and says it's a Mac, but we can distinguish by detecting touch support.
    (isMac() === true && window.navigator.maxTouchPoints > 1)
  );
}

/**
 * Detect if the current platform is iOS.
 *
 * Returns `undefined` in non-browser environments (e.g. SSR).
 */
export function isIOS(): boolean | undefined {
  return isIPhone() || isIPad();
}

export type Platform = 'web' | 'electron' | 'mobile';

/**
 * Detect if the current platform is macOS/iOS (Apple device).
 */
export const detectIsMac = (): boolean => {
  return isMac() === true || isIOS() === true;
};

export const detectPlatform = (): Platform => {
  if (typeof window === 'undefined') {
    return 'web';
  }

  // Electron should always win, regardless of window size.
  if (window.electronAPI !== undefined) {
    return 'electron';
  }

  // React Native WebView is always mobile (handles display/font scaling edge cases)
  if (detectReactNativeWebView()) {
    return 'mobile';
  }

  // Fallback to viewport-based detection for standalone browsers
  if (window.innerWidth < 700) {
    return 'mobile';
  }

  return 'web';
};

export const usePlatform = (): UsePlatformReturn => {
  const [platform, setPlatform] = useState<Platform>(() => detectPlatform());
  const isMac = useMemo(() => detectIsMac(), []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const updatePlatform = (): void => setPlatform(detectPlatform());
    updatePlatform();

    window.addEventListener('resize', updatePlatform);
    return (): void => window.removeEventListener('resize', updatePlatform);
  }, []);

  return {
    platform,
    isWeb: platform === 'web',
    isElectron: platform === 'electron',
    isMobile: platform === 'mobile',
    isMac,
  };
};
