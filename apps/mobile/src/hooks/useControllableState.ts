import { useCallback, useState } from 'react';

/**
 * Handles both controlled (value prop) and uncontrolled (defaultValue) patterns.
 */
export const useControllableState = <T>({
  prop,
  defaultProp,
  onChange,
}: {
  prop?: T | undefined;
  defaultProp?: T | undefined;
  onChange?: ((value: T) => void) | undefined;
}): [T | undefined, (value: T) => void] => {
  const [uncontrolledState, setUncontrolledState] = useState<T | undefined>(defaultProp);
  const isControlled = prop !== undefined;
  const value = isControlled ? prop : uncontrolledState;

  const handleChange = useCallback(
    (newValue: T) => {
      if (!isControlled) setUncontrolledState(newValue);
      onChange?.(newValue);
    },
    [isControlled, onChange],
  );

  return [value, handleChange];
};
