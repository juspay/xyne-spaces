import { type PressableStateCallbackType } from 'react-native';
import type { AnyProps, Style } from './types';

// --------------------------------------------------

export function isTextChildren(
  children: React.ReactNode | ((state: PressableStateCallbackType) => React.ReactNode),
): boolean {
  return Array.isArray(children)
    ? children.every(child => typeof child === 'string')
    : typeof children === 'string';
}

// --------------------------------------------------

export function composeRefs<T>(...refs: (React.Ref<T> | undefined)[]): (node: T) => void {
  return (node: T) =>
    refs.forEach(ref => {
      if (typeof ref === 'function') {
        ref(node);
      } else if (ref !== null) {
        (ref as React.MutableRefObject<T>).current = node;
      }
    });
}

// --------------------------------------------------

type EventHandler = (...args: unknown[]) => void;

export function mergeProps(slotProps: AnyProps, childProps: AnyProps): AnyProps {
  // all child props should override
  const overrideProps = { ...childProps };

  for (const propName in childProps) {
    const slotPropValue = slotProps[propName];
    const childPropValue = childProps[propName];

    const isHandler = /^on[A-Z]/.test(propName);
    if (isHandler) {
      // if the handler exists on both, we compose them
      if (slotPropValue && childPropValue) {
        overrideProps[propName] = ((...args: unknown[]) => {
          (childPropValue as EventHandler)(...args);
          (slotPropValue as EventHandler)(...args);
        }) as EventHandler;
      }
      // but if it exists only on the slot, we use only this one
      else if (slotPropValue) {
        overrideProps[propName] = slotPropValue;
      }
    }
    // if it's `style`, we merge them
    else if (propName === 'style') {
      overrideProps[propName] = combineStyles(
        slotPropValue as Style | undefined,
        childPropValue as Style | undefined,
      );
    } else if (propName === 'className') {
      overrideProps[propName] = [slotPropValue, childPropValue].filter(Boolean).join(' ');
    }
  }

  return { ...slotProps, ...overrideProps };
}

// --------------------------------------------------

/**
 * Combines slot and child styles into a style array.
 *
 * Returns a style array instead of flattening via StyleSheet.flatten,
 * because flatten deep-copies style objects into plain objects, which
 * destroys Reanimated animated style bindings (useAnimatedStyle / SharedValues).
 * React Native natively handles nested style arrays, so an array is safe here.
 */
function combineStyles(
  slotStyle?: Style,
  childValue?: Style,
): Style | Style[] | ((state: PressableStateCallbackType) => Style | Style[]) {
  if (typeof slotStyle === 'function' && typeof childValue === 'function') {
    return (state: PressableStateCallbackType) => {
      return [slotStyle(state), childValue(state)] as Style[];
    };
  }
  if (typeof slotStyle === 'function') {
    return (state: PressableStateCallbackType) => {
      return childValue ? ([slotStyle(state), childValue] as Style[]) : slotStyle(state);
    };
  }
  if (typeof childValue === 'function') {
    return (state: PressableStateCallbackType) => {
      return slotStyle ? ([slotStyle, childValue(state)] as Style[]) : childValue(state);
    };
  }

  if (!slotStyle) return childValue;
  if (!childValue) return slotStyle;
  return [slotStyle, childValue] as Style[];
}
