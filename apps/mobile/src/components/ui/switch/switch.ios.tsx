import { forwardRef, useMemo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Host, Toggle } from '@expo/ui/swift-ui';
import { disabled, labelsHidden, toggleStyle } from '@expo/ui/swift-ui/modifiers';
import { useCSSVariable, useUniwind } from 'uniwind';

import { createContext } from '@/src/contexts/create-context';
import { haptics } from '@/src/utils/haptics';
import type { SwitchContextValue, SwitchProps } from './switch.types';

const [SwitchProvider, useSwitch] = createContext<SwitchContextValue>({
  name: 'SwitchContext',
});

/**
 * Native SwiftUI toggle on iOS (liquid glass on iOS 26+).
 *
 * Layout/accessibility props (`style`, `className`, rest) are forwarded onto
 * the RN wrapper. Reanimated `animation` / custom thumb `children` are not
 * applicable to the system control — callers that need those should keep
 * using the Android implementation's compound API.
 */
const Switch = forwardRef<View, SwitchProps>((props, ref) => {
  const {
    isSelected = false,
    isDisabled = false,
    onSelectedChange,
    accessibilityLabel,
    className,
    style,
    testID,
    children: _children,
    animation: _animation,
    isAnimatedStyleActive: _isAnimatedStyleActive,
    onPressIn: _onPressIn,
    onPressOut: _onPressOut,
  } = props;
  const { theme } = useUniwind();
  const brand = useCSSVariable('--color-brand') as string;

  const modifiers = useMemo(
    () => [labelsHidden(), toggleStyle('switch'), ...(isDisabled ? [disabled(true)] : [])],
    [isDisabled],
  );

  const contextValue = useMemo(
    () => ({
      isSelected,
      isDisabled,
    }),
    [isSelected, isDisabled],
  );

  const label = typeof accessibilityLabel === 'string' ? accessibilityLabel : 'Switch';
  const wrapperStyle: StyleProp<ViewStyle> =
    typeof style === 'function' ? styles.slot : [styles.slot, style];

  return (
    <SwitchProvider value={contextValue}>
      <View
        ref={ref}
        collapsable={false}
        accessibilityRole='switch'
        accessibilityState={{ checked: isSelected, disabled: isDisabled }}
        accessibilityLabel={label}
        pointerEvents={isDisabled ? 'none' : 'box-none'}
        style={wrapperStyle}
        {...(className !== undefined ? { className } : {})}
        {...(testID !== undefined ? { testID } : {})}
      >
        <Host
          matchContents
          ignoreSafeArea='all'
          colorScheme={theme === 'dark' ? 'dark' : 'light'}
          seedColor={brand}
          style={styles.host}
        >
          <Toggle
            isOn={isSelected}
            label={label}
            modifiers={modifiers}
            onIsOnChange={next => {
              if (isDisabled) return;
              void (next ? haptics.toggleOn() : haptics.toggleOff());
              onSelectedChange?.(next);
            }}
          />
        </Host>
      </View>
    </SwitchProvider>
  );
});

Switch.displayName = 'Lotus.Switch';

const styles = StyleSheet.create({
  slot: {
    width: 51,
    height: 31,
    justifyContent: 'center',
    alignItems: 'center',
  },
  host: {
    width: 51,
    height: 31,
  },
});

export { useSwitch };
export default Switch;
