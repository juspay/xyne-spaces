import * as React from 'react';
import { useImperativeHandle, useRef } from 'react';

interface AugmentRefProps<T> {
  ref: React.Ref<T>;
  methods?: Record<string, (...args: unknown[]) => unknown>;
  deps?: unknown[];
}

export const useAugmentedRef = <T>({ ref, methods, deps = [] }: AugmentRefProps<T>) => {
  const augmentedRef = useRef<T>(null);

  useImperativeHandle(
    ref,
    () => {
      if (typeof augmentedRef === 'function' || !augmentedRef?.current) {
        return {} as T;
      }
      return {
        ...augmentedRef.current,
        ...methods,
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps,
  );
  return augmentedRef;
};
