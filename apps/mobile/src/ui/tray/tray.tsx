import { useCallback, useMemo, useReducer, useRef, type ReactElement, type ReactNode } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import { useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { TRAY_SPRING } from './constants';
import { TrayContext, type TrayApi, type TrayInternals } from './tray-context';
import {
  canGoBack as canGoBackOf,
  currentView,
  initialTrayState,
  trayReducer,
  type TrayAction,
  type TrayState,
} from './history';

export type TrayProps = {
  /** View shown when `open()` is called with no argument. */
  defaultView?: string;
  children: ReactNode;
};

/**
 * Root of the tray. Owns visibility, view history and the animation drivers;
 * renders no UI of its own.
 *
 * React sees exactly two state changes per interaction — `visible` and `stack`.
 * Everything visual (translate, height, overlay, scale, crossfade) runs on the
 * UI thread from the shared values below, so a drag never touches React.
 */
export function Tray({ defaultView = 'default', children }: TrayProps): ReactElement {
  const reduce = useCallback(
    (state: TrayState, action: TrayAction) => trayReducer(state, action, defaultView),
    [defaultView],
  );
  const [state, dispatch] = useReducer(reduce, defaultView, initialTrayState);

  const progress = useSharedValue(0);
  const dragY = useSharedValue(0);
  const contentHeight = useSharedValue(0);

  // Android back is claimed only while open, and only then — a permanently
  // registered handler would swallow back on every screen the tray lives on.
  const backSubscription = useRef<{ remove: () => void } | null>(null);

  const close = useCallback(() => {
    backSubscription.current?.remove();
    backSubscription.current = null;
    dragY.set(withSpring(0, TRAY_SPRING));
    progress.set(
      withTiming(0, { duration: 180 }, finished => {
        // Unmount only once it is off screen, so the exit still has a view.
        if (finished) scheduleOnRN(dispatch, { type: 'close' } as TrayAction);
      }),
    );
  }, [dragY, progress]);

  const goBack = useCallback(() => {
    dispatch({ type: 'goBack' });
  }, []);

  const open = useCallback(
    (view?: string) => {
      dispatch({ type: 'open', view });
      dragY.set(0);
      progress.set(withSpring(1, TRAY_SPRING));

      backSubscription.current?.remove();
      backSubscription.current = BackHandler.addEventListener('hardwareBackPress', () => {
        // Back unwinds the view stack first and dismisses only at the root,
        // which is what a native navigation stack does.
        if (canGoBackOf(stateRef.current)) {
          goBack();
          return true;
        }
        close();
        return true;
      });
    },
    [close, dragY, goBack, progress],
  );

  // The handler above is registered once per open and must read today's stack,
  // not the one captured when it was registered.
  const stateRef = useRef(state);
  stateRef.current = state;

  const setView = useCallback((id: string) => {
    dispatch({ type: 'setView', id });
  }, []);

  const value = useMemo<TrayApi & TrayInternals>(
    () => ({
      open,
      close,
      setView,
      goBack,
      visible: state.visible,
      view: currentView(state, defaultView),
      canGoBack: canGoBackOf(state),
      contentHeight,
      dragY,
      progress,
    }),
    [close, contentHeight, defaultView, dragY, goBack, open, progress, setView, state],
  );

  /**
   * A flex box rather than a bare provider.
   *
   * `Tray.Content` positions absolutely against this, which is what lets the
   * sheet cover the screen without a portal. It renders after the app content
   * it is given, so it also paints above it — including over the tab bar.
   */
  return (
    <TrayContext.Provider value={value}>
      <View style={styles.root}>{children}</View>
    </TrayContext.Provider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
