import { apiInstance } from '../clients/apiClient';
import { toast } from 'sonner';
import { getFileDimensions } from '../../components/ui/utils/files';

export interface YSweetAuthRequest {
  docId: string;
  channelId?: string;
  title?: string;
  viewAccessId?: string;
  editAccessId?: string;
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

export class CanvasService {
  async getYSweetAuthToken(request: YSweetAuthRequest): Promise<YSweetAuthToken> {
    const response = await apiInstance.post<YSweetAuthToken>('/ysweet/auth', request);
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
