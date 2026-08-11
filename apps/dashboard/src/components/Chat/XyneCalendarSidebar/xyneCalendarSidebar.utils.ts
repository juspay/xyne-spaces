import { useSyncExternalStore } from 'react';
import type { Variants } from 'framer-motion';

export const XYNE_CALENDAR_SIDEBAR_DEFAULT_WIDTH = 384;
export const XYNE_CALENDAR_SIDEBAR_MIN_WIDTH = 320;
export const XYNE_CALENDAR_SIDEBAR_MAX_WIDTH = 640;

const XYNE_CALENDAR_SIDEBAR_WIDTH_STORAGE_KEY = 'xyne-calendar-sidebar-width';

export const XYNE_CALENDAR_SIDEBAR_ANIMATION_DURATION = 0.32;

export const xyneCalendarSidebarMotionVariants: Variants = {
  hidden: { opacity: 0, x: 24 },
  visible: {
    opacity: 1,
    x: 0,
    transition: {
      duration: XYNE_CALENDAR_SIDEBAR_ANIMATION_DURATION,
      ease: [0.22, 1, 0.36, 1],
    },
  },
};

export const getXyneCalendarSidebarWidth = (): number => {
  try {
    const savedWidth = Number(localStorage.getItem(XYNE_CALENDAR_SIDEBAR_WIDTH_STORAGE_KEY));
    if (Number.isFinite(savedWidth) && savedWidth > 0) {
      return Math.min(
        XYNE_CALENDAR_SIDEBAR_MAX_WIDTH,
        Math.max(XYNE_CALENDAR_SIDEBAR_MIN_WIDTH, savedWidth),
      );
    }
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }

  return XYNE_CALENDAR_SIDEBAR_DEFAULT_WIDTH;
};

export const saveXyneCalendarSidebarWidth = (width: number): void => {
  const nextWidth = Math.round(
    Math.min(XYNE_CALENDAR_SIDEBAR_MAX_WIDTH, Math.max(XYNE_CALENDAR_SIDEBAR_MIN_WIDTH, width)),
  );

  try {
    localStorage.setItem(XYNE_CALENDAR_SIDEBAR_WIDTH_STORAGE_KEY, String(nextWidth));
  } catch {
    // Resizing still works for the current session when storage is unavailable.
  }
};

let isOpen = false;
const listeners = new Set<() => void>();

const emitChange = (): void => {
  for (const listener of listeners) listener();
};

const setOpen = (nextOpen: boolean): void => {
  if (isOpen === nextOpen) return;
  isOpen = nextOpen;
  emitChange();
};

export const openXyneCalendarSidebar = (): void => setOpen(true);

export const closeXyneCalendarSidebar = (): void => setOpen(false);

export const toggleXyneCalendarSidebar = (): void => setOpen(!isOpen);

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
};

const getSnapshot = (): boolean => isOpen;

export const useIsXyneCalendarSidebarOpen = (): boolean =>
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
