import { useRef, useState } from 'react';

export interface OptimisticSave<T> {
  value: T;
  saving: boolean;
  save: (next: T, request: () => Promise<void>) => void;
}

/**
 * Saves that fire per selection rather than on dialog close need two things the
 * plain "await then re-render" shape does not give: the picker has to show the
 * new value before the round trip returns, and a second click during that trip
 * must not be computed from — or overwrite — the pre-click value.
 */
export function useOptimisticSave<T>(committed: T): OptimisticSave<T> {
  const chain = useRef<Promise<void>>(Promise.resolve());
  const depth = useRef(0);
  const [pending, setPending] = useState<{ value: T } | null>(null);
  const [saving, setSaving] = useState(false);

  const save = (next: T, request: () => Promise<void>): void => {
    setPending({ value: next });
    depth.current += 1;
    setSaving(true);
    chain.current = chain.current
      .then(request)
      .catch(() => undefined)
      .finally(() => {
        depth.current -= 1;
        if (depth.current > 0) return;
        setSaving(false);
        setPending(null);
      });
  };

  return { value: pending ? pending.value : committed, saving, save };
}
