import { useCallback, useMemo, type ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { useCSSVariable, useUniwind } from 'uniwind';
import { X } from 'lucide-react-native';

import {
  fromDragOrder,
  peekTabLayout,
  saveTabLayout,
  toDragOrder,
} from '@/src/features/bottom-navigation';
import { Tray, useTray, useTrayBodySpace } from '@/src/ui/tray';
import { withAlpha } from '@/src/utils/color';
import { haptics } from '@/src/utils/haptics';

import { CustomizeList, type CustomizeListPalette } from './customize-list';

/**
 * Row fills, fixed rather than themed.
 *
 * A resting row has to read as a solid block against the sheet, and a lifted one
 * as clearly picked up off it. Tinting the foreground by an alpha gave neither —
 * the lift was see-through and the rows underneath showed through.
 */
const ROW_FILL = { light: '#F4F4F6', dark: '#242426' } as const;
const ROW_FILL_LIFTED = { light: '#E3E3E8', dark: '#3A3A3E' } as const;

const VIEW_ID = 'customize';

const HEADER_HEIGHT = 48;
const FOOTER_BUTTON_HEIGHT = 48;
const FOOTER_PADDING = 16;
/** Header, plus the button and the even gap above and below it. */
const CHROME_HEIGHT = HEADER_HEIGHT + FOOTER_BUTTON_HEIGHT + FOOTER_PADDING * 2;

/**
 * Customize, as a tray view.
 *
 * Exports the view rather than its own `<Tray>`: the shell owns the tray so the
 * bar's menu button can open it, and so this feature never has to import the
 * navigation feature that imports it back.
 */
export function CustomizeTrayView(): ReactElement {
  const { close } = useTray();
  const { theme } = useUniwind();
  const isDark = theme === 'dark';

  const surface = useCSSVariable('--color-card') as string;
  const foreground = useCSSVariable('--color-foreground') as string;
  const muted = useCSSVariable('--color-secondary-text') as string;

  const rowFill = isDark ? ROW_FILL.dark : ROW_FILL.light;

  const palette: CustomizeListPalette = useMemo(
    () => ({
      groupBackground: rowFill,
      liftedBackground: isDark ? ROW_FILL_LIFTED.dark : ROW_FILL_LIFTED.light,
      separator: withAlpha(foreground, isDark ? 0.1 : 0.07),
      label: foreground,
      icon: foreground,
      handle: foreground,
      sectionLabel: muted,
      emptyGroupBackground: rowFill,
      emptyGroupLabel: muted,
    }),
    [foreground, isDark, muted, rowFill],
  );

  /**
   * The working copy. A shared value so a drag mutates it on the UI thread
   * without a single React render, and read back once on Save.
   */
  const order = useSharedValue<string[]>(toDragOrder(peekTabLayout()));

  /**
   * The list is a scroller, so it needs a height — unbounded inside an
   * auto-sizing sheet it reports zero and collapses it. Asking the tray how much
   * room is left, rather than hardcoding one, is what keeps the footer on screen
   * when the catalog is long enough to hit the sheet's ceiling.
   */
  const listHeight = useTrayBodySpace(CHROME_HEIGHT);

  const cancel = useCallback(() => {
    void haptics.buttonTap();
    close();
  }, [close]);

  const save = useCallback(() => {
    void haptics.success();
    saveTabLayout(fromDragOrder(order.get()));
    close();
  }, [close, order]);

  return (
    <Tray.View
      id={VIEW_ID}
      footer={
        <Pressable
          accessibilityRole='button'
          accessibilityLabel='Save'
          onPress={save}
          style={[styles.save, { backgroundColor: foreground }]}
        >
          <Text style={[styles.saveLabel, { color: surface }]}>Save</Text>
        </Pressable>
      }
    >
      <View style={styles.header}>
        <Pressable
          accessibilityRole='button'
          accessibilityLabel='Cancel'
          hitSlop={8}
          onPress={cancel}
          style={[styles.close, { backgroundColor: rowFill }]}
        >
          <X size={18} color={foreground} />
        </Pressable>
        <Text style={[styles.title, { color: foreground }]}>Customize</Text>
        {/* Balances the close button so the title stays optically centred. */}
        <View style={styles.close} />
      </View>

      <View style={{ height: listHeight }}>
        <CustomizeList order={order} palette={palette} />
      </View>
    </Tray.View>
  );
}

const styles = StyleSheet.create({
  header: {
    // Stated, not implied by the 36pt button plus its padding: the space
    // reservation above reads this number, and the two must not drift.
    height: HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingBottom: 12,
  },
  close: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
  },
  save: {
    marginHorizontal: 16,
    // Even above and below. The sheet adds the safe-area inset outside this.
    marginVertical: FOOTER_PADDING,
    height: FOOTER_BUTTON_HEIGHT,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
});
