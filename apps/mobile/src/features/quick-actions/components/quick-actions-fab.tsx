import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useIsFocused } from 'expo-router/react-navigation';
import { useAnimatedReaction, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Portal } from '@/src/components/primitives/portal';
import { TAB_OVERLAY_PORTAL_HOST } from '@/src/components/tab-pager/tab-overlay-portal';
import { entryHref, tabEntry } from '@/src/features/bottom-navigation';
import type { TabName } from '@/src/navigation/routes';

import { quickActionsForTab, type QuickActionId } from '../model/actions';
import { requestCreateSection } from '../state/create-section-request';
import { openQuickActionSheet } from '../state/sheet-store';
import { FabActions } from './fab-actions';
import { FabButton } from './fab-button';
import { FabBackdrop, FabOverlay } from './fab-scrim';

const PORTAL_NAME = 'quick-actions-fab';

export type QuickActionsFabProps = {
  /**
   * Which tab is rendering it. Explicit rather than inferred from the route:
   * the screen already knows, and reading it back out of the segments means
   * guessing during the frames where the navigator has not settled.
   */
  tab: TabName;
};

/**
 * The shell's quick-action button, as offered by one tab.
 *
 * Rendered by a screen rather than by the layout, which is what lets a tab
 * opt out by not rendering it — and means a tab that offers nothing
 * (`quickActionsForTab` returns empty) costs nothing at all.
 *
 * Drawn above the bar, not inside the screen: the shell paints the bottom bar
 * over the scene, so a menu rendered inline would open underneath it, and the
 * design dims the bar along with everything else. `TAB_OVERLAY_PORTAL_HOST`
 * is mounted after the navigator for exactly this.
 *
 * Paint order is document order rather than `zIndex` — iOS reorders subviews
 * to honour `zIndex`, which is the shakiest arrangement for a set that
 * animates. The button is last, so it sits above the scrims for free.
 */
export function QuickActionsFab({ tab }: QuickActionsFabProps): ReactElement | null {
  const router = useRouter();
  const actions = quickActionsForTab(tab);

  /**
   * React Navigation's own focus, not the tab pager's.
   *
   * The portal host is shared by every tab and all of them are mounted at
   * once, so without a focus gate each screen's button renders into it and
   * they stack. The pager's version of this question exists because the
   * classic shell mounts five pages inside one screen and navigation calls
   * the whole group focused; this navigator has one scene per tab and
   * already knows which is in front.
   */
  const isFocused = useIsFocused();
  const isOpen = useSharedValue(false);

  /*
   * A React mirror of the shared value, for the back button alone.
   *
   * Everything else reads `isOpen` on the UI thread and never re-renders.
   * `BackHandler` is JS-side, so it needs to know — this writes a boolean
   * only when it actually flips, which is twice per open.
   */
  const [isOpenForBack, setIsOpenForBack] = useState(false);

  useAnimatedReaction(
    () => isOpen.get(),
    (open, previous) => {
      if (open !== previous) scheduleOnRN(setIsOpenForBack, open);
    },
  );

  useEffect(() => {
    if (!isOpenForBack) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      isOpen.set(false);
      return true;
    });
    return (): void => subscription.remove();
  }, [isOpen, isOpenForBack]);

  // Leaving the tab with the menu open would otherwise bring it back open.
  useEffect(() => {
    if (!isFocused) isOpen.set(false);
  }, [isFocused, isOpen]);

  /**
   * What an action does — the one place the difference between "opens a
   * surface" and "goes somewhere" lives.
   *
   * Exhaustive over `QuickActionId`, so adding an action fails the typecheck
   * here until it has been given something to do.
   */
  const handleSelect = useCallback(
    (id: QuickActionId): void => {
      switch (id) {
        case 'create-dm':
          openQuickActionSheet('create-dm');
          break;
        case 'create-channel':
          openQuickActionSheet('create-channel');
          break;
        case 'create-section':
          // Not a shell sheet: the section tray belongs to the Channels screen,
          // which is the only place this action is offered.
          requestCreateSection();
          break;
        case 'instant-call':
          openQuickActionSheet('instant-call');
          break;
        case 'record-note': {
          // Through the catalog rather than a second copy of the path, so the
          // bar's Recordings entry and this one cannot drift.
          const entry = tabEntry('recordings');
          const href = entry ? entryHref(entry) : null;
          if (href !== null) router.push(href);
          break;
        }
      }
    },
    [router],
  );

  if (!isFocused || actions.length === 0) return null;

  return (
    <Portal name={PORTAL_NAME} hostName={TAB_OVERLAY_PORTAL_HOST}>
      <View pointerEvents='box-none' style={StyleSheet.absoluteFill}>
        <FabBackdrop isOpen={isOpen} />
        <FabActions isOpen={isOpen} actions={actions} onSelect={handleSelect} />
        <FabOverlay isOpen={isOpen} />
        <FabButton isOpen={isOpen} />
      </View>
    </Portal>
  );
}
