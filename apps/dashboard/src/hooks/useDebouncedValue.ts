import { useEffect, useState } from 'react';

export const useDebouncedValue = <T>(value: T, delayMs: number): T => {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    if (delayMs <= 0) {
      setDebouncedValue(value);
      return;
    }

    const timeoutId = setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);

    return () => clearTimeout(timeoutId);
  }, [delayMs, value]);

  return debouncedValue;
};
