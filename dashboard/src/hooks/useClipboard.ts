import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { copyImageToClipboard } from '../utils/clipboardUtils';

type UseClipboardReturn = {
  copy: (text: string) => Promise<boolean>;
  copyImage: (blob: Blob) => Promise<boolean>;
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

  const copyImage = useCallback(async (blob: Blob) => {
    try {
      await copyImageToClipboard(blob);
      setSuccess(true);
      toast.success('Image copied', {
        description: 'The image has been copied to your clipboard',
        duration: 2000,
      });
      return true;
    } catch (error) {
      setSuccess(false);
      toast.error('Failed to copy image', {
        description: error instanceof Error ? error.message : 'Please try again',
        duration: 3000,
      });
      return false;
    }
  }, []);

  return { copy, copyImage, success };
}
