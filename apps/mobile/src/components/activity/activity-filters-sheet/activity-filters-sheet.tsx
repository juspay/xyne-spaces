import { useValue } from '@legendapp/state/react';
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  BackHandler,
  Keyboard,
  Platform,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, { FadeIn, FadeOut, LayoutAnimationConfig } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppBottomSheet } from '@/src/components/ui/app-bottom-sheet';
import {
  activityPreferences$,
  applyActivityPreferences,
} from '@/src/features/activity/state/preferences-store';
import { haptics } from '@/src/utils/haptics';

import { FADE_IN_MS, FADE_OUT_MS, filtersViewHeight, peopleViewHeight } from './constants';
import { FiltersView } from './filters-view';
import { PeopleView } from './people-view';

type SheetView = 'filters' | 'people';

export type ActivityFiltersSheetProps = {
  isOpen: boolean;
  onClose: () => void;
  /** Marks the chip on show as read. */
  onMarkAsRead: () => void;
};

/**
 * The classic Activity screen's filters, in the app's own bottom sheet: the
 * same controls, and the same stores, as the Spaces design's filter tray.
 *
 * One sheet for both steps. Picking "who" cross-fades the controls out and the
 * searchable list in, while the sheet eases to the list's height; choosing
 * someone fades back.
 *
 * Mounted only while open (and through its close animation), so a closed
 * sheet costs the screen nothing.
 */
export function ActivityFiltersSheet(props: ActivityFiltersSheetProps): ReactElement | null {
  const [isMounted, setIsMounted] = useState(props.isOpen);

  useEffect(() => {
    if (props.isOpen) setIsMounted(true);
  }, [props.isOpen]);

  const handleDismissed = useCallback(() => setIsMounted(false), []);

  if (!isMounted) return null;
  return <SheetBody {...props} onDismissed={handleDismissed} />;
}

function SheetBody({
  isOpen,
  onClose,
  onMarkAsRead,
  onDismissed,
}: ActivityFiltersSheetProps & { onDismissed: () => void }): ReactElement {
  const [view, setView] = useState<SheetView>('filters');
  const showsPerson = useValue(() => activityPreferences$.actorKind.get() !== 'all');
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  // Android lifts the whole sheet above the navigation bar itself.
  const bottomInset = Platform.OS === 'ios' ? insets.bottom : 0;
  const snapPoints = useMemo(() => {
    const filtersHeight = filtersViewHeight(showsPerson, bottomInset);
    return [view === 'people' ? peopleViewHeight(windowHeight, filtersHeight) : filtersHeight];
  }, [bottomInset, showsPerson, view, windowHeight]);

  const close = useCallback(() => {
    Keyboard.dismiss();
    onClose();
  }, [onClose]);

  // Closing hands the feed anything a control had not yet: a segment dismissed
  // mid-slide never settles.
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open) return;
      applyActivityPreferences();
      close();
    },
    [close],
  );

  const showFilters = useCallback(() => {
    Keyboard.dismiss();
    setView('filters');
  }, []);

  const handleMarkAsRead = useCallback(() => {
    onMarkAsRead();
    void haptics.success();
    close();
  }, [close, onMarkAsRead]);

  // Back steps out of the picker first, then closes the sheet.
  useEffect(() => {
    if (Platform.OS !== 'android' || !isOpen) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (view === 'people') showFilters();
      else handleOpenChange(false);
      return true;
    });
    return (): void => subscription.remove();
  }, [handleOpenChange, isOpen, showFilters, view]);

  return (
    <AppBottomSheet
      isOpen={isOpen}
      onOpenChange={handleOpenChange}
      onDismiss={onDismissed}
      mode='snap'
      snapPoints={snapPoints}
      backdropOpacity={0.4}
    >
      {/*
        A plain filling view, not gorhom's BottomSheetView: that one is
        absolutely positioned and as tall as its content, and both steps here
        are absolutely positioned so they can cross-fade — inside it they
        would get no height at all.
      */}
      <View style={styles.body}>
        {/* The first view arrives with the sheet; only a step between views fades. */}
        <LayoutAnimationConfig skipEntering>
          {view === 'filters' ? (
            <Animated.View
              key='filters'
              entering={FadeIn.duration(FADE_IN_MS)}
              exiting={FadeOut.duration(FADE_OUT_MS)}
              style={StyleSheet.absoluteFill}
            >
              <FiltersView
                onMarkAsRead={handleMarkAsRead}
                onChoosePerson={() => setView('people')}
              />
            </Animated.View>
          ) : (
            <Animated.View
              key='people'
              entering={FadeIn.duration(FADE_IN_MS)}
              exiting={FadeOut.duration(FADE_OUT_MS)}
              style={StyleSheet.absoluteFill}
            >
              <PeopleView onBack={showFilters} />
            </Animated.View>
          )}
        </LayoutAnimationConfig>
      </View>
    </AppBottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1 },
});
