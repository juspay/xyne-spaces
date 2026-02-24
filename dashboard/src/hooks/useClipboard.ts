import { useState, useCallback } from 'react';

type UseClipboardReturn = {
  copy: (text: string) => Promise<boolean>;
  success: boolean | null; // null = not attempted yet
};

export function useClipboard(): UseClipboardReturn {
  const [success, setSuccess] = useState<boolean | null>(null);

  const copy = useCallback(async (text: string) => {
    if (!navigator?.clipboard) {
      setSuccess(false);
      return false;
    }

    try {
      await navigator.clipboard.writeText(text);
      setSuccess(true);
      return true;
    } catch {
      setSuccess(false);
      return false;
    }
  }, []);

  return { copy, success };
}
