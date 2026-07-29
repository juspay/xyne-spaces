import { useCallback, useEffect, useRef, useState } from 'react';
import { useClipboard } from './useClipboard';

export function useCopyButton(resetMs = 1500): {
  copied: boolean;
  copy: (text: string) => void;
} {
  const { copy: rawCopy } = useClipboard();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(
    (text: string) => {
      void rawCopy(text).then(ok => {
        if (!ok) return;
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), resetMs);
      });
    },
    [rawCopy, resetMs],
  );

  return { copied, copy };
}
