import { useEffect, useState } from 'react';

/**
 * The value, but only after it has stopped changing for `delayMs`.
 *
 * For text that drives a request: the component renders what was typed and
 * queries what settled, so a query key does not change per keystroke.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    if (value === settled) return;
    const timer = setTimeout(() => { setSettled(value); }, delayMs);
    return () => { clearTimeout(timer); };
  }, [value, settled, delayMs]);

  return settled;
}
