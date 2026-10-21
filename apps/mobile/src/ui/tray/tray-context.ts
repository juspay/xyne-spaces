import { createContext, useContext } from 'react';
import type { SharedValue } from 'react-native-reanimated';

export type TrayApi = {
  /** Opens the tray, optionally straight to a view. */
  open: (view?: string) => void;
  close: () => void;
  /** Pushes a view onto the history stack. */
  setView: (id: string) => void;
  /** Pops back to the previous view. A no-op at the root. */
  goBack: () => void;
  visible: boolean;
  /** Current view id. */
  view: string;
  canGoBack: boolean;
};

export type TrayInternals = {
  /**
   * Measured height of everything the sheet draws — grab strip, body and
   * footer together.
   *
   * One measurement rather than a sum of parts. Summing meant every piece the
   * sheet drew had to be remembered, and the grab strip was not: the box came
   * out shorter than its own contents and `overflow: hidden` took the
   * difference off the bottom, which is the footer.
   */
  contentHeight: SharedValue<number>;
  /** Live drag offset, so the sheet and the backdrop read the same gesture. */
  dragY: SharedValue<number>;
  /** 0 closed, 1 open. Drives translate, overlay and scale together. */
  progress: SharedValue<number>;
};

export const TrayContext = createContext<(TrayApi & TrayInternals) | null>(null);

export function useTray(): TrayApi {
  const value = useContext(TrayContext);
  if (value === null) {
    throw new Error('useTray must be used inside <Tray>');
  }
  return value;
}

/** Internals, for the tray's own parts. Not exported from the barrel. */
export function useTrayInternals(): TrayApi & TrayInternals {
  const value = useContext(TrayContext);
  if (value === null) {
    throw new Error('Tray parts must be used inside <Tray>');
  }
  return value;
}
