import { useCallback, useRef, useState } from 'react';
import { generateCanvasTitle } from '../services/Canvas/canvasTitleService';

export function useCanvasTitleGenerator(): {
  isGenerating: boolean;
  error: Error | null;
  generate: (content: string) => Promise<string | null>;
  cancel: () => void;
  reset: () => void;
} {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setIsGenerating(false);
  }, []);

  const generate = useCallback(async (content: string): Promise<string | null> => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setIsGenerating(true);
    setError(null);

    try {
      const title = await generateCanvasTitle(content, controller.signal);
      return controller.signal.aborted ? null : title;
    } catch (caught) {
      if (controller.signal.aborted) return null;
      const nextError = caught instanceof Error ? caught : new Error('Failed to generate title');
      setError(nextError);
      return null;
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setIsGenerating(false);
      }
    }
  }, []);

  const reset = useCallback(() => {
    cancel();
    setError(null);
  }, [cancel]);

  return { isGenerating, error, generate, cancel, reset };
}
