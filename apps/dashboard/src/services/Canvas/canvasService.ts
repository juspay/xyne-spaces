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
  wsPublicKey?: string;
}

export interface CanvasFileUploadResponse {
  attachmentId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  thumbnailUrl?: string;
}

/**
 * Tickets are single use, but @y-sweet/client retries the same token 3 times before it fetches
 * a new one. Fetch a new ticket for any attempt that would reuse a spent one.
 */
export function fetchTicketPerAttempt(provider: object): void {
  const p = provider as unknown as {
    clientToken: YSweetAuthToken | null;
    ensureClientToken(): Promise<YSweetAuthToken>;
    attemptToConnect(token: YSweetAuthToken): Promise<boolean>;
  };
  const attempt = p.attemptToConnect.bind(p);
  const spent = new Set<string | undefined>();
  p.attemptToConnect = async (token): Promise<boolean> => {
    let next: YSweetAuthToken | null = token;
    if (spent.has(token.token)) {
      p.clientToken = null;
      // A throw here would end the provider's connect loop. A failed attempt keeps its backoff.
      next = await p.ensureClientToken().catch(() => null);
      if (!next) return false;
    }
    spent.add(next.token);
    return attempt(next);
  };
}

// Cache for prefetched canvas data
const prefetchedCanvases = new Map<string, { token: YSweetAuthToken; timestamp: number }>();
const PREFETCH_CACHE_TTL = 1000 * 60 * 50; // 50 minutes (same as staleTime)

export class CanvasService {
  /** Canvas metadata (docId, authorization) without a token. */
  async getYSweetAuthToken(request: YSweetAuthRequest): Promise<YSweetAuthToken> {
    const response = await apiInstance.post<YSweetAuthToken>('/ysweet/auth', {
      ...request,
      tokenType: 'none',
    });
    return response.data;
  }

  /** A single-use WebSocket ticket. Only the provider's connect should ask for one. */
  async getYSweetTicket(
    request: YSweetAuthRequest,
    wsHandshakeHash?: string,
  ): Promise<YSweetAuthToken> {
    const response = await apiInstance.post<YSweetAuthToken>('/ysweet/auth', {
      ...request,
      tokenType: 'ticket',
      ...(wsHandshakeHash ? { wsHandshakeHash } : {}),
    });
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
      tokenType: 'none',
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
