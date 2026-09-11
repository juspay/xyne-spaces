import type { Canvas } from './Canvas.types';

interface GetDisplayedCanvasesParams {
  canvases: Canvas[];
  activeFilter: 'all' | 'created_by_me' | 'shared';
  currentUserId?: string | undefined;
  selectedSharedByUserId?: string | null;
  searchQuery: string;
}

export const canvasMatchesSharedByFilter = ({
  canvas,
  currentUserId,
  selectedSharedByUserId,
}: {
  canvas: Canvas;
  currentUserId?: string | undefined;
  selectedSharedByUserId?: string | null | undefined;
}): boolean => {
  if (selectedSharedByUserId) return canvas.createdBy === selectedSharedByUserId;
  return currentUserId ? canvas.createdBy !== currentUserId : true;
};

export function getDisplayedCanvases({
  canvases,
  activeFilter,
  currentUserId,
  selectedSharedByUserId,
  searchQuery,
}: GetDisplayedCanvasesParams): Canvas[] {
  let filtered = canvases;
  if (activeFilter === 'created_by_me' && currentUserId) {
    filtered = canvases.filter(canvas => canvas.createdBy === currentUserId);
  } else if (activeFilter === 'shared') {
    filtered = canvases.filter(canvas =>
      canvasMatchesSharedByFilter({ canvas, currentUserId, selectedSharedByUserId }),
    );
  }

  const query = searchQuery.trim().toLowerCase();
  if (!query) {
    return filtered;
  }

  return filtered.filter(canvas => canvas.title.toLowerCase().includes(query));
}
