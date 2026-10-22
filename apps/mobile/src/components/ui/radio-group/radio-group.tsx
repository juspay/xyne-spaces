import { forwardRef, useCallback, useMemo } from 'react';
import { AnimationSettingsProvider } from '@/src/contexts/animation-settings-context';
import { childrenToString } from '@/src/utils/children-to-string';
import * as RadioGroupPrimitives from '../../primitives/radio-group';
import Radio from '../radio/radio';
import Label from '../label/label';
import { useRadioGroupRootAnimation, DISPLAY_NAME } from './radio-group.utils';
import { RadioGroupItemProvider } from './radio-group.context';
import { radioGroupClassNames } from './radio-group.styles';
import type {
  RadioGroupItemProps,
  RadioGroupItemRenderProps,
  RadioGroupProps,
} from './radio-group.types';

const useRadioGroup = RadioGroupPrimitives.useRadioGroupContext;

// --------------------------------------------------

const RadioGroupRoot = forwardRef<RadioGroupPrimitives.RootRef, RadioGroupProps>((props, ref) => {
  const { className, isDisabled = false, isInvalid = false, animation, ...restProps } = props;

  const rootClassName = radioGroupClassNames.root({
    className,
  });

  const { isAllAnimationsDisabled } = useRadioGroupRootAnimation({
    animation,
  });

  const animationSettingsContextValue = useMemo(
    () => ({
      isAllAnimationsDisabled,
    }),
    [isAllAnimationsDisabled],
  );

  return (
    <AnimationSettingsProvider value={animationSettingsContextValue}>
      <RadioGroupPrimitives.Root
        ref={ref}
        className={rootClassName}
        isDisabled={isDisabled}
        isInvalid={isInvalid}
        {...restProps}
      />
    </AnimationSettingsProvider>
  );
});

// --------------------------------------------------

const RadioGroupItem = forwardRef<RadioGroupPrimitives.ItemRef, RadioGroupItemProps>(
  (props, ref) => {
    const { children, value, isDisabled, isInvalid, variant, className, ...restProps } = props;

    const stringifiedChildren =
      typeof children === 'function' ? null : childrenToString(children as React.ReactNode);

    const {
      value: groupValue,
      onValueChange: groupOnValueChange,
      isInvalid: groupIsInvalid,
      isDisabled: groupIsDisabled,
      variant: groupVariant,
    } = useRadioGroup();

    const isSelected = groupValue === value;
    const isDisabledValue = isDisabled ?? groupIsDisabled ?? false;
    const isInvalidValue = isInvalid ?? groupIsInvalid ?? false;

    /** Selects this item in the group (radio behavior: always selects, never deselects) */
    const handleSelectedChange = useCallback(() => {
      groupOnValueChange(value);
    }, [groupOnValueChange, value]);

    const finalVariant =
      variant !== undefined ? variant : groupVariant !== undefined ? groupVariant : 'primary';

    const itemClassName = radioGroupClassNames.item({
      className,
    });

    const renderProps: RadioGroupItemRenderProps = {
      isSelected,
      isDisabled: isDisabledValue,
      isInvalid: isInvalidValue,
    };

    const content = stringifiedChildren ? (
      <>
        <Label>{stringifiedChildren}</Label>
        <Radio />
      </>
    ) : typeof children === 'function' ? (
      children(renderProps)
    ) : (
      children
    );

    const contextValue = useMemo(
      () => ({
        isSelected,
        isDisabled: isDisabledValue,
        isInvalid: isInvalidValue,
        variant: finalVariant,
        onSelectedChange: handleSelectedChange,
      }),
      [isSelected, isDisabledValue, isInvalidValue, finalVariant, handleSelectedChange],
    );

    return (
      <RadioGroupItemProvider value={contextValue}>
        <RadioGroupPrimitives.Item
          ref={ref}
          value={value}
          className={itemClassName}
          isDisabled={isDisabledValue}
          {...restProps}
        >
          {content}
        </RadioGroupPrimitives.Item>
      </RadioGroupItemProvider>
    );
  },
);

RadioGroupRoot.displayName = DISPLAY_NAME.RADIO_GROUP_ROOT;
RadioGroupItem.displayName = DISPLAY_NAME.RADIO_GROUP_ITEM;

const CompoundRadioGroup = Object.assign(RadioGroupRoot, {
  /** Individual radio option within a RadioGroup */
  Item: RadioGroupItem,
});

export default CompoundRadioGroup;
export { useRadioGroup };
