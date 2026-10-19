import { forwardRef, useCallback, useMemo } from 'react';
import type { GestureResponderEvent } from 'react-native';
import { View, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import { AnimationSettingsProvider } from '@/src/contexts/animation-settings-context';
import { createContext } from '@/src/contexts/create-context';
import * as SwitchPrimitives from '../../primitives/switch';
import * as SwitchPrimitivesTypes from '../../primitives/switch/switch.types';
import {
  SwitchAnimationProvider,
  useSwitchRootAnimation,
  useSwitchThumbAnimation,
  DISPLAY_NAME,
} from './switch.utils';
import { switchClassNames, switchStyleSheet } from './switch.styles';
import type {
  SwitchContentProps,
  SwitchContextValue,
  SwitchProps,
  SwitchRenderProps,
  SwitchThumbProps,
} from './switch.types';

const AnimatedSwitchRoot = Animated.createAnimatedComponent(SwitchPrimitives.Root);

const AnimatedSwitchThumb = Animated.createAnimatedComponent(SwitchPrimitives.Thumb);

const [SwitchProvider, useSwitch] = createContext<SwitchContextValue>({
  name: 'SwitchContext',
});

// --------------------------------------------------

const Switch = forwardRef<SwitchPrimitivesTypes.RootRef, SwitchProps>((props, ref) => {
  const {
    children,
    isDisabled,
    isSelected,
    onSelectedChange,
    className,
    style,
    animation,
    isAnimatedStyleActive = true,
    onPressIn,
    onPressOut,
    ...restProps
  } = props;

  const rootClassName = switchClassNames.root({
    isDisabled,
    className,
  });

  const { rContainerStyle, isSwitchPressed, contentContainerWidth, isAllAnimationsDisabled } =
    useSwitchRootAnimation({
      animation,
      isSelected,
    });

  const rootStyle = isAnimatedStyleActive
    ? [switchStyleSheet.borderCurve, rContainerStyle, style]
    : [switchStyleSheet.borderCurve, style];

  const contextValue = useMemo(
    () => ({
      isSelected: isSelected ?? false,
      isDisabled: isDisabled ?? false,
    }),
    [isSelected, isDisabled],
  );

  const animationContextValue = useMemo(
    () => ({
      isSwitchPressed,
      contentContainerWidth,
    }),
    [isSwitchPressed, contentContainerWidth],
  );

  const animationSettingsContextValue = useMemo(
    () => ({
      isAllAnimationsDisabled,
    }),
    [isAllAnimationsDisabled],
  );

  const handlePressIn = useCallback(
    (event: GestureResponderEvent) => {
      isSwitchPressed.set(true);
      onPressIn?.(event);
    },
    [isSwitchPressed, onPressIn],
  );

  const handlePressOut = useCallback(
    (event: GestureResponderEvent) => {
      isSwitchPressed.set(false);
      onPressOut?.(event);
    },
    [isSwitchPressed, onPressOut],
  );

  const renderProps: SwitchRenderProps = {
    isSelected: isSelected ?? false,
    isDisabled: isDisabled ?? false,
  };

  const content =
    typeof children === 'function' ? children(renderProps) : (children ?? <SwitchThumb />);

  return (
    <SwitchProvider value={contextValue}>
      <AnimationSettingsProvider value={animationSettingsContextValue}>
        <SwitchAnimationProvider value={animationContextValue}>
          <AnimatedSwitchRoot
            ref={ref}
            className={rootClassName}
            style={rootStyle}
            isSelected={isSelected ?? false}
            isDisabled={isDisabled ?? false}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            onLayout={e => {
              contentContainerWidth.set(e.nativeEvent.layout.width);
            }}
            {...(onSelectedChange !== undefined ? { onSelectedChange } : {})}
            {...restProps}
          >
            {content}
          </AnimatedSwitchRoot>
        </SwitchAnimationProvider>
      </AnimationSettingsProvider>
    </SwitchProvider>
  );
});

// --------------------------------------------------

const SwitchThumb = forwardRef<SwitchPrimitivesTypes.ThumbRef, SwitchThumbProps>((props, ref) => {
  const {
    children,
    className,
    style,
    animation,
    isAnimatedStyleActive = true,
    ...restProps
  } = props;

  const { isSelected, isDisabled } = useSwitch();

  const thumbClassName = switchClassNames.thumb({
    className,
  });

  const { rContainerStyle } = useSwitchThumbAnimation({
    animation,
    style: style as ViewStyle | undefined,
    className: thumbClassName,
    isSelected,
  });

  const thumbStyle = isAnimatedStyleActive
    ? [switchStyleSheet.borderCurve, rContainerStyle, style]
    : [switchStyleSheet.borderCurve, style];

  const renderProps: SwitchRenderProps = {
    isSelected: isSelected ?? false,
    isDisabled: isDisabled ?? false,
  };

  const content = typeof children === 'function' ? children(renderProps) : children;

  return (
    <AnimatedSwitchThumb ref={ref} className={thumbClassName} style={thumbStyle} {...restProps}>
      {content}
    </AnimatedSwitchThumb>
  );
});

// --------------------------------------------------

const SwitchStartContent = forwardRef<View, SwitchContentProps>((props, ref) => {
  const { children, className, ...restProps } = props;

  const startContentClassName = switchClassNames.startContent({
    className,
  });

  return (
    <View ref={ref} className={startContentClassName} {...restProps}>
      {children}
    </View>
  );
});

// --------------------------------------------------

const SwitchEndContent = forwardRef<View, SwitchContentProps>((props, ref) => {
  const { children, className, ...restProps } = props;

  const endContentClassName = switchClassNames.endContent({
    className,
  });

  return (
    <View ref={ref} className={endContentClassName} {...restProps}>
      {children}
    </View>
  );
});

// --------------------------------------------------

Switch.displayName = DISPLAY_NAME.SWITCH_ROOT;
SwitchThumb.displayName = DISPLAY_NAME.SWITCH_THUMB;
SwitchStartContent.displayName = DISPLAY_NAME.SWITCH_START_CONTENT;
SwitchEndContent.displayName = DISPLAY_NAME.SWITCH_END_CONTENT;

const CompoundSwitch = Object.assign(Switch, {
  /** @optional Sliding thumb with spring animations */
  Thumb: SwitchThumb,
  /** @optional Content shown when switch is off (left side) */
  StartContent: SwitchStartContent,
  /** @optional Content shown when switch is on (right side) */
  EndContent: SwitchEndContent,
});

export { useSwitch };
export default CompoundSwitch;
