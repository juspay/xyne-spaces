import type { Canvas } from './Canvas.types';

interface GetDisplayedCanvasesParams {
  canvases: Canvas[];
  quartoDocs?: Canvas[];
  activeFilter: 'all' | 'created_by_me' | 'quarto_docs';
  currentUserId?: string | undefined;
  searchQuery: string;
}

export function getDisplayedCanvases({
  canvases,
  quartoDocs = [],
  activeFilter,
  currentUserId,
  searchQuery,
}: GetDisplayedCanvasesParams): Canvas[] {
  const source = activeFilter === 'quarto_docs' ? quartoDocs : canvases;
  const filtered =
    activeFilter === 'created_by_me' && currentUserId
      ? source.filter(canvas => canvas.createdBy === currentUserId)
      : source;

  const query = searchQuery.trim().toLowerCase();
  if (!query) {
    return filtered;
  }

  return filtered.filter(
    canvas =>
      canvas.title.toLowerCase().includes(query) ||
      (canvas.userRepo?.toLowerCase().includes(query) ?? false),
  );
}
