import { forwardRef } from 'react';
import { Pressable, View, type GestureResponderEvent } from 'react-native';
import { haptics } from '@/src/utils/haptics';
import * as Slot from '../slot';
import type { RootProps, RootRef, ThumbProps, ThumbRef } from './switch.types';

// --------------------------------------------------

const Root = forwardRef<RootRef, RootProps>(
  (
    {
      asChild,
      isSelected,
      onSelectedChange,
      isDisabled,
      onPress: onPressProp,
      // 'aria-valuetext': ariaValueText,
      ...props
    },
    ref,
  ) => {
    function onPress(ev: GestureResponderEvent) {
      if (isDisabled) return;
      const newValue = !isSelected;
      // Every switch in the app buzzes from here, with the direction of the
      // toggle carried in the haptic itself.
      void (newValue ? haptics.toggleOn() : haptics.toggleOff());
      onSelectedChange?.(newValue);
      onPressProp?.(ev);
    }

    const Component = asChild ? Slot.Pressable : Pressable;

    return (
      <Component
        ref={ref}
        aria-disabled={isDisabled}
        role='switch'
        aria-checked={isSelected}
        onPress={onPress}
        accessibilityState={{
          checked: isSelected,
          disabled: isDisabled,
        }}
        disabled={isDisabled}
        {...props}
      />
    );
  },
);

Root.displayName = 'HeroUINative.Primitive.Switch.Root';

// --------------------------------------------------

const Thumb = forwardRef<ThumbRef, ThumbProps>(({ asChild, ...props }, ref) => {
  const Component = asChild ? Slot.View : View;

  return <Component ref={ref} role='presentation' {...props} />;
});

Thumb.displayName = 'HeroUINative.Primitive.Switch.Thumb';

export { Root, Thumb };
