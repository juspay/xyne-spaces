import { useId } from 'react';

export function useInputIds(providedId?: string) {
  const generatedId = useId();
  const baseId = providedId || generatedId;

  return {
    inputId: `${baseId}-input`,
    labelId: `${baseId}-label`,
    hintId: `${baseId}-hint`,
    errorId: `${baseId}-error`,
  };
}
