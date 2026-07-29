import type { Canvas } from './Canvas.types';

interface GetDisplayedCanvasesParams {
  canvases: Canvas[];
  activeFilter: 'all' | 'created_by_me';
  currentUserId?: string | undefined;
  searchQuery: string;
}

export function getDisplayedCanvases({
  canvases,
  activeFilter,
  currentUserId,
  searchQuery,
}: GetDisplayedCanvasesParams): Canvas[] {
  const filtered =
    activeFilter === 'created_by_me' && currentUserId
      ? canvases.filter(canvas => canvas.createdBy === currentUserId)
      : canvases;

  const query = searchQuery.trim().toLowerCase();
  if (!query) {
    return filtered;
  }

  return filtered.filter(canvas => canvas.title.toLowerCase().includes(query));
}
