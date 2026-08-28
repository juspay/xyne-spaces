import { apiInstance } from '../clients/apiClient';
import { toast } from 'sonner';
import { getFileDimensions } from '../../components/ui/utils/files';
import { QueryClient } from '@tanstack/react-query';
import { logger, Event } from '../../utils/logger';

export interface YSweetAuthRequest {
  docId: string;
  channelId?: string;
  projectId?: string;
  folderId?: string;
  title?: string;
}

export interface CreateCollaborativeCanvasRequest {
  id: string;
  title?: string;
  channelId?: string;
  projectId?: string;
  folderId?: string;
}

export interface YSweetAuthToken {
  url: string;
  baseUrl: string;
  docId: string;
  token?: string;
  authorization?: 'full' | 'read-only';
}

export interface CanvasFileUploadResponse {
  attachmentId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  thumbnailUrl?: string;
}

export interface CanvasEditAccessRequestResponse {
  success: boolean;
  requested: number;
  alreadyRequested?: number;
  alreadyHasEditAccess?: boolean;
}

// Cache for prefetched canvas data
const prefetchedCanvases = new Map<string, { token: YSweetAuthToken; timestamp: number }>();
const PREFETCH_CACHE_TTL = 1000 * 60 * 50; // 50 minutes (same as staleTime)

export class CanvasService {
  async getYSweetAuthToken(request: YSweetAuthRequest): Promise<YSweetAuthToken> {
    const response = await apiInstance.post<YSweetAuthToken>('/ysweet/auth', request);
    return response.data;
  }

  async createCollaborativeCanvas(
    request: CreateCollaborativeCanvasRequest,
  ): Promise<YSweetAuthToken> {
    const response = await apiInstance.post<YSweetAuthToken>('/ysweet/auth', {
      docId: request.id,
      channelId: request.channelId,
      projectId: request.projectId,
      folderId: request.folderId,
      title: request.title || 'Untitled Canvas',
    });
    return response.data;
  }

  async prefetchCanvas(
    queryClient: QueryClient,
    canvasId: string,
    options?: { channelId?: string },
  ): Promise<void> {
    const cached = prefetchedCanvases.get(canvasId);
    if (cached && Date.now() - cached.timestamp < PREFETCH_CACHE_TTL) {
      return;
    }

    try {
      const token = await this.getYSweetAuthToken({
        docId: canvasId,
        ...(options?.channelId ? { channelId: options.channelId } : {}),
      });

      queryClient.setQueryData(['ysweet-auth', canvasId, options?.channelId], token);

      prefetchedCanvases.set(canvasId, { token, timestamp: Date.now() });
    } catch (error) {
      logger.warn(Event.CANVAS_PREFETCH_FAILED, {
        canvasId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  async requestCanvasEditAccess(canvasId: string): Promise<CanvasEditAccessRequestResponse> {
    const response = await apiInstance.post<CanvasEditAccessRequestResponse>(
      `/canvas/${canvasId}/request-edit-access`,
    );
    return response.data;
  }

  async uploadCanvasFile(canvasId: string, file: File): Promise<string> {
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('canvasId', canvasId);

      // Extract dimensions for images/videos
      const dimensions = await getFileDimensions(file);
      if (dimensions) {
        formData.append('width', String(dimensions.width));
        formData.append('height', String(dimensions.height));
      }

      const response = await apiInstance.post<CanvasFileUploadResponse>('/canvas/upload', formData);

      return response.data.attachmentId;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to upload file to canvas';

      toast.error('Upload Failed', {
        description: errorMessage,
      });

      throw new Error(errorMessage);
    }
  }
}

export const canvasService = new CanvasService();
