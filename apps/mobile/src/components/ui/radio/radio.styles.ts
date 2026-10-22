import { StyleSheet } from 'react-native';
import { tv } from 'tailwind-variants';
import { combineStyles } from '@/src/utils/combine-styles';

/** Root item layout style */
const root = tv({
  base: 'flex-row items-center justify-between gap-3',
});

/** Indicator container style (the radio circle) */
const indicator = tv({
  base: 'size-6 rounded-full border border-gray-200 items-center justify-center overflow-hidden',
  variants: {
    variant: {
      primary: 'bg-gray-100 shadow-xs',
      secondary: 'bg-gray-100 shadow-xs',
    },
    isSelected: {
      true: 'bg-brand border-brand',
      false: '',
    },
    isInvalid: {
      true: 'bg-transparent border-red-500',
      false: '',
    },
  },
  compoundVariants: [
    {
      isInvalid: true,
      isSelected: true,
      className: 'bg-danger border-danger',
    },
  ],
  defaultVariants: {
    variant: 'primary',
    isSelected: false,
    isInvalid: false,
  },
});

/**
 * Indicator thumb style definition
 *
 * @note ANIMATED PROPERTIES (cannot be set via className):
 * The following property is animated and cannot be overridden using Tailwind classes:
 * - `transform` (specifically `scale`) - Animated for selection transitions (unselected: 1.5, selected: 1)
 *
 * To customize this property, use the `animation` prop on `Radio.IndicatorThumb`:
 * ```tsx
 * <Radio.IndicatorThumb
 *   animation={{
 *     scale: { value: [1.5, 1], timingConfig: { duration: 300, easing: Easing.out(Easing.ease) } }
 *   }}
 * />
 * ```
 *
 * To completely disable animated styles and apply your own via className or style prop,
 * set `isAnimatedStyleActive={false}` on `Radio.IndicatorThumb`.
 */
const indicatorThumb = tv({
  base: 'size-2.5 rounded-full bg-white shadow-xs',
  variants: {
    isSelected: {
      true: 'opacity-100',
      false: 'opacity-0',
    },
  },
});

export const radioClassNames = combineStyles({
  root,
  indicator,
  indicatorThumb,
});

export const radioStyleSheet = StyleSheet.create({
  borderCurve: {
    borderCurve: 'continuous',
  },
});
