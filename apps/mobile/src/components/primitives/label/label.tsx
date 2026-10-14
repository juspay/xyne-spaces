import { forwardRef } from 'react';
import { Pressable, Text as RNText } from 'react-native';
import * as Slot from '../slot';
import type { RootProps, RootRef, TextProps, TextRef } from './label.types';

const Root = forwardRef<RootRef, RootProps>(({ asChild, ...props }, ref) => {
  const Component = asChild ? Slot.Pressable : Pressable;

  return <Component ref={ref} {...props} />;
});

Root.displayName = 'Lotus.Primitive.Label.Root';

// --------------------------------------------------

const Text = forwardRef<TextRef, TextProps>(({ asChild, ...props }, ref) => {
  const Component = asChild ? Slot.Text : RNText;

  return <Component ref={ref} {...props} />;
});

Text.displayName = 'Lotus.Primitive.Label.Text';

export { Root, Text };
