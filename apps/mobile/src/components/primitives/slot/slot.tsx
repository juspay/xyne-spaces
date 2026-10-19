import {
  cloneElement,
  forwardRef,
  isValidElement,
  type ComponentPropsWithoutRef,
  type ComponentRef,
} from 'react';
import {
  Image as RNImage,
  Pressable as RNPressable,
  Text as RNText,
  View as RNView,
  type PressableProps as RNPressableProps,
  type TextProps as RNTextProps,
  type ViewProps as RNViewProps,
} from 'react-native';
import type { AnyProps, ImageSlotProps } from './types';
import { composeRefs, isTextChildren, mergeProps } from './utils';

// --------------------------------------------------

type ElementWithRef = React.ReactElement & { ref?: React.Ref<unknown> };

const Pressable = forwardRef<React.ComponentRef<typeof RNPressable>, RNPressableProps>(
  (props, forwardedRef) => {
    const { children, ...pressableSlotProps } = props;

    if (!isValidElement(children)) {
      return null;
    }

    const childRef = (children as ElementWithRef).ref as
      React.Ref<React.ComponentRef<typeof RNPressable>> | undefined;

    return cloneElement<
      React.ComponentPropsWithoutRef<typeof RNPressable>,
      React.ComponentRef<typeof RNPressable>
    >(isTextChildren(children) ? <></> : children, {
      ...mergeProps(pressableSlotProps, children.props as AnyProps),
      ref: forwardedRef ? composeRefs(forwardedRef, childRef) : childRef,
    });
  },
);

Pressable.displayName = 'Lotus.Primitive.Slot.Pressable';

// --------------------------------------------------

const View = forwardRef<React.ComponentRef<typeof RNView>, RNViewProps>((props, forwardedRef) => {
  const { children, ...viewSlotProps } = props;

  if (!isValidElement(children)) {
    return null;
  }

  const childRef = (children as ElementWithRef).ref as
    React.Ref<React.ComponentRef<typeof RNView>> | undefined;

  return cloneElement<ComponentPropsWithoutRef<typeof RNView>, ComponentRef<typeof RNView>>(
    isTextChildren(children) ? <></> : children,
    {
      ...mergeProps(viewSlotProps, children.props as AnyProps),
      ref: forwardedRef ? composeRefs(forwardedRef, childRef) : childRef,
    },
  );
});

View.displayName = 'Lotus.Primitive.Slot.View';

// --------------------------------------------------

const Text = forwardRef<ComponentRef<typeof RNText>, RNTextProps>((props, forwardedRef) => {
  const { children, ...textSlotProps } = props;

  if (!isValidElement(children)) {
    return null;
  }

  const childRef = (children as ElementWithRef).ref as
    React.Ref<React.ComponentRef<typeof RNText>> | undefined;

  return cloneElement<
    React.ComponentPropsWithoutRef<typeof RNText>,
    React.ComponentRef<typeof RNText>
  >(isTextChildren(children) ? <></> : children, {
    ...mergeProps(textSlotProps, children.props as AnyProps),
    ref: forwardedRef ? composeRefs(forwardedRef, childRef) : childRef,
  });
});

Text.displayName = 'Lotus.Primitive.Slot.Text';

// --------------------------------------------------

const Image = forwardRef<ComponentRef<typeof RNImage>, ImageSlotProps>((props, forwardedRef) => {
  const { children, ...imageSlotProps } = props;

  if (!isValidElement(children)) {
    return null;
  }

  const childRef = (children as ElementWithRef).ref as
    React.Ref<React.ComponentRef<typeof RNImage>> | undefined;

  return cloneElement<ComponentPropsWithoutRef<typeof RNImage>, ComponentRef<typeof RNImage>>(
    isTextChildren(children) ? <></> : children,
    {
      ...mergeProps(imageSlotProps, children.props as AnyProps),
      ref: forwardedRef ? composeRefs(forwardedRef, childRef) : childRef,
    },
  );
});

Image.displayName = 'Lotus.Primitive.Slot.Image';

export { Image, Pressable, Text, View };
