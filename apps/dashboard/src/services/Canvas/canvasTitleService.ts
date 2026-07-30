import { apiInstance } from '../clients/apiClient';
import { MAX_CANVAS_TITLE_LENGTH } from '../../utils/canvasTitleUtils';

interface CanvasTitleResponse {
  title: string;
}

export async function generateCanvasTitle(content: string, signal?: AbortSignal): Promise<string> {
  const response = await apiInstance.post<CanvasTitleResponse>(
    '/ai/generate-canvas-title',
    { content, maxLength: MAX_CANVAS_TITLE_LENGTH },
    signal ? { signal } : undefined,
  );

  return response.data.title.trim();
}
