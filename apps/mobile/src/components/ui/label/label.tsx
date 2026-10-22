import { forwardRef, useMemo } from 'react';
import { AnimationSettingsProvider } from '@/src/contexts/animation-settings-context';
import type { PressableRef, TextRef } from '@/src/components/primitives/types';
import { childrenToString } from '@/src/utils/children-to-string';
import { createContext } from '@/src/contexts/create-context';
import * as LabelPrimitives from '@/src/components/primitives/label';
import { useLabelRootAnimation, DISPLAY_NAME } from './label.utils';
import { labelClassNames } from './label.styles';
import type { LabelContextValue, LabelProps, LabelTextProps } from './label.types';
import { Text } from 'react-native';

const [LabelProvider, useLabel] = createContext<LabelContextValue>({
  name: 'LabelContext',
});

// --------------------------------------------------

const Label = forwardRef<PressableRef, LabelProps>((props, ref) => {
  const { children, isDisabled, isRequired, isInvalid, className, animation, ...restProps } = props;

  const stringifiedChildren = childrenToString(children);

  const { isAllAnimationsDisabled } = useLabelRootAnimation({
    animation,
  });

  const animationSettingsContextValue = useMemo(
    () => ({
      isAllAnimationsDisabled,
    }),
    [isAllAnimationsDisabled],
  );

  const contextValue = useMemo(
    () => ({
      isDisabled: isDisabled ?? false,
      isRequired: isRequired ?? false,
      isInvalid: isInvalid ?? false,
    }),
    [isDisabled, isRequired, isInvalid],
  ) as LabelContextValue;

  const rootClassName = labelClassNames.root({
    isDisabled,
    className,
  });

  return (
    <AnimationSettingsProvider value={animationSettingsContextValue}>
      <LabelProvider value={contextValue}>
        <LabelPrimitives.Root
          ref={ref}
          isDisabled={isDisabled ?? false}
          className={rootClassName}
          {...restProps}
        >
          {stringifiedChildren ? <LabelText>{stringifiedChildren}</LabelText> : children}
        </LabelPrimitives.Root>
      </LabelProvider>
    </AnimationSettingsProvider>
  );
});

// --------------------------------------------------

const LabelText = forwardRef<TextRef, LabelTextProps>((props, ref) => {
  const { children, className, classNames, styles, style, ...restProps } = props;

  const { isDisabled, isRequired, isInvalid } = useLabel();

  const { text, asterisk } = labelClassNames.label({
    isDisabled,
    isInvalid,
  });

  const textClassName = text({
    className: [className, classNames?.text],
  });

  const asteriskClassName = asterisk({
    className: classNames?.asterisk,
  });

  return (
    <Text ref={ref} className={textClassName} style={[style, styles?.text]} {...restProps}>
      {children}
      {isRequired && (
        <Text className={asteriskClassName} style={styles?.asterisk}>
          {' '}
          *
        </Text>
      )}
    </Text>
  );
});

// --------------------------------------------------

Label.displayName = DISPLAY_NAME.LABEL_ROOT;
LabelText.displayName = DISPLAY_NAME.LABEL_TEXT;

const CompoundLabel = Object.assign(Label, {
  /** Label text - renders text or custom content with optional asterisk */
  Text: LabelText,
});

export { useLabel };
export default CompoundLabel;
