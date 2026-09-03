import { useCallback } from 'react';
import { toast } from 'sonner';
import { useZero } from '../../hooks/useZero';
import { mutators } from '../../zero/mutators';
import type { Canvas } from './Canvas.types';

type CanvasArchiveToggleOptions = {
  onArchivedStateChange?: (canvasId: string, isArchived: boolean) => void;
};

export function useCanvasArchiveToggle({
  onArchivedStateChange,
}: CanvasArchiveToggleOptions = {}): (canvas: Canvas) => void {
  const z = useZero();

  return useCallback(
    (canvas: Canvas): void => {
      const nextIsArchived = !canvas.isArchived;

      void (async (): Promise<void> => {
        try {
          const result = z.mutate(
            nextIsArchived
              ? mutators.canvas.archiveCanvas({ canvasId: canvas.id })
              : mutators.canvas.unarchiveCanvas({ canvasId: canvas.id }),
          );
          const serverResult = await result.server;

          if (serverResult.type === 'error') {
            throw new Error(
              serverResult.error.message ||
                `Failed to ${nextIsArchived ? 'archive' : 'unarchive'} canvas`,
            );
          }

          onArchivedStateChange?.(canvas.id, nextIsArchived);
          toast.success(nextIsArchived ? 'Canvas archived' : 'Canvas unarchived');
        } catch (error) {
          const fallback = `Failed to ${nextIsArchived ? 'archive' : 'unarchive'} canvas. Please try again.`;
          toast.error('Error', {
            description: error instanceof Error ? error.message : fallback,
          });
        }
      })();
    },
    [onArchivedStateChange, z],
  );
}
