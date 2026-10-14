import { createContext, forwardRef, useContext } from 'react';
import { Pressable, View, type GestureResponderEvent } from 'react-native';
import { haptics } from '@/src/utils/haptics';
import * as Slot from '../slot';
import type {
  IndicatorProps,
  IndicatorRef,
  ItemProps,
  ItemRef,
  RootProps,
  RootRef,
} from './radio-group.types';

const RadioGroupContext = createContext<RootProps | null>(null);

const Root = forwardRef<RootRef, RootProps>(
  (
    { asChild, value, onValueChange, isDisabled = false, isInvalid = false, variant, ...viewProps },
    ref,
  ) => {
    const Component = asChild ? Slot.View : View;

    return (
      <RadioGroupContext.Provider
        value={{
          value,
          isDisabled,
          onValueChange,
          isInvalid,
          ...(variant !== undefined && { variant }),
        }}
      >
        <Component ref={ref} role='radiogroup' {...viewProps} />
      </RadioGroupContext.Provider>
    );
  },
);

Root.displayName = 'Lotus.Primitive.RadioGroup.Root';

function useRadioGroupContext() {
  const context = useContext(RadioGroupContext);

  if (!context) {
    throw new Error(
      'RadioGroup compound components cannot be rendered outside the RadioGroup component',
    );
  }

  return context;
}

// --------------------------------------------------

const Item = forwardRef<ItemRef, ItemProps>(
  (
    { asChild, value: itemValue, isDisabled: disabledProp = false, onPress: onPressProp, ...props },
    ref,
  ) => {
    const { isDisabled, value, onValueChange } = useRadioGroupContext();

    function onPress(ev: GestureResponderEvent) {
      if (isDisabled || disabledProp) return;
      // Re-picking the current value is a no-op, so it gets no haptic either.
      if (value !== itemValue) void haptics.selection();
      onValueChange(itemValue);
      onPressProp?.(ev);
    }

    const Component = asChild ? Slot.Pressable : Pressable;

    return (
      <Component
        ref={ref}
        role='radio'
        onPress={onPress}
        aria-checked={value === itemValue}
        disabled={(isDisabled || disabledProp) ?? false}
        accessibilityState={{
          disabled: (isDisabled || disabledProp) ?? false,
          checked: value === itemValue,
        }}
        {...props}
      />
    );
  },
);

Item.displayName = 'Lotus.Primitive.RadioGroup.Item';

// --------------------------------------------------

const Indicator = forwardRef<IndicatorRef, IndicatorProps>(({ asChild, ...props }, ref) => {
  const Component = asChild ? Slot.View : View;

  return <Component ref={ref} role='presentation' {...props} />;
});

Indicator.displayName = 'Lotus.Primitive.RadioGroup.Indicator';

export { Indicator, Item, Root, useRadioGroupContext };
