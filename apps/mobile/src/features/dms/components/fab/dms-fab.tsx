import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import { useIsFocused } from 'expo-router/react-navigation';
import { useAnimatedReaction, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { CreateDmDrawer } from '@/src/components/chat/create-dm-drawer';
import { Portal } from '@/src/components/primitives/portal';
import { TAB_OVERLAY_PORTAL_HOST } from '@/src/components/tab-pager/tab-overlay-portal';

import type { DmsFabActionId } from '../../model/fab-actions';
import { FabActions } from './fab-actions';
import { FabButton } from './fab-button';
import { FabBackdrop, FabOverlay } from './fab-scrim';

const PORTAL_NAME = 'dms-fab';

/**
 * Above the bar, not inside the screen.
 *
 * The shell draws the bottom bar over the scene, so a menu rendered inline
 * would open underneath it — and the design dims the bar along with
 * everything else. `TAB_OVERLAY_PORTAL_HOST` is mounted after the navigator
 * for exactly this.
 *
 * Paint order is document order rather than `zIndex` — iOS reorders subviews
 * to honour `zIndex`, which is the shakiest arrangement for a set that
 * animates. The button is last, so it sits above the scrims for free.
 */
export function DmsFab(): ReactElement {
  /**
   * React Navigation's own focus, not the tab pager's.
   *
   * That host is shared by every tab, and all of them are mounted at once,
   * so without a focus gate each screen's button renders into it and they
   * stack. The pager's version of this question exists because the classic
   * shell mounts five pages inside one screen and navigation calls the whole
   * group focused; this navigator has one scene per tab and already knows
   * which is in front, so its own answer is the honest one.
   */
  const isFocused = useIsFocused();

  const isOpen = useSharedValue(false);
  const [isCreateDmOpen, setIsCreateDmOpen] = useState(false);

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
    return () => subscription.remove();
  }, [isOpen, isOpenForBack]);

  // Leaving the tab with the menu open would otherwise bring it back open.
  useEffect(() => {
    if (!isFocused) isOpen.set(false);
  }, [isFocused, isOpen]);

  /**
   * Exhaustive over the action ids, so adding one to `DMS_FAB_ACTIONS` fails
   * here until it has been given something to do.
   */
  const handleSelect = useCallback((id: DmsFabActionId): void => {
    switch (id) {
      case 'create-dm':
        setIsCreateDmOpen(true);
        break;
    }
  }, []);

  return (
    <>
      {isFocused ? (
        <Portal name={PORTAL_NAME} hostName={TAB_OVERLAY_PORTAL_HOST}>
          <View pointerEvents='box-none' style={StyleSheet.absoluteFill}>
            <FabBackdrop isOpen={isOpen} />
            <FabActions isOpen={isOpen} onSelect={handleSelect} />
            <FabOverlay isOpen={isOpen} />
            <FabButton isOpen={isOpen} />
          </View>
        </Portal>
      ) : null}

      {/*
        Outside the portal and outside the focus gate: the drawer brings its
        own full-screen presentation, and closing it is the user's to do —
        not something a tab change should decide for them.
      */}
      <CreateDmDrawer isOpen={isCreateDmOpen} onClose={() => setIsCreateDmOpen(false)} />
    </>
  );
}
