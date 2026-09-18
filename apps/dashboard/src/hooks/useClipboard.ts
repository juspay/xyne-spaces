import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { copyImageToClipboard, type ImageClipboardSource } from '../utils/clipboardUtils';
import { logger, Event as LogEvent } from '../utils/logger';

type UseClipboardReturn = {
  copy: (text: string) => Promise<boolean>;
  copyImage: (source: ImageClipboardSource) => Promise<boolean>;
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

  const copyImage = useCallback(async (source: ImageClipboardSource) => {
    try {
      await copyImageToClipboard(source);
      setSuccess(true);
      toast.success('Image copied', {
        description: 'The image has been copied to your clipboard',
        duration: 2000,
      });
      return true;
    } catch (error) {
      setSuccess(false);
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'copy_image_failed',
        message: 'Failed to copy image to clipboard',
        error,
      });
      toast.error('Failed to copy image', {
        description: error instanceof Error ? error.message : 'Please try again',
        duration: 3000,
      });
      return false;
    }
  }, []);

  return { copy, copyImage, success };
}
