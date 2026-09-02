import { logger, Event as LogEvent } from '../../utils/logger';
/**
 * Simple File Fetch Service with React Query Caching
 * Uses apiClient.ts for authenticated file operations
 * Provides automatic caching for ALL callers (hooks, direct calls, etc.)
 */

import { apiInstance } from './apiClient';
import { queryClient } from './queryClient';
import { AxiosResponse } from 'axios';
import { reactNativeBridge } from '../../utils/reactNativeBridge';

export interface FetchOptions {
  abortController?: AbortController;
  forceRefresh?: boolean;
}

const resolveUrl = (source: string): string => {
  if (source.startsWith('http') || source.startsWith('/')) {
    return source;
  }
  return `/attachments/${source}/download`;
};

/**
 * Fetch file and return as File object
 */
export const fetchFile = async (
  source: string,
  fileName: string,
  mimeType: string,
): Promise<File> => {
  const url = resolveUrl(source);
  const queryKey = ['file', url, fileName, mimeType];

  return queryClient.fetchQuery<File>({
    queryKey,
    queryFn: async ({ signal }) => {
      const response = await apiInstance.get<Blob>(url, {
        responseType: 'blob',
        signal,
      });

      const blob: Blob = response.data;
      if (!blob || blob.size === 0) {
        throw new Error('The file is empty or unavailable');
      }
      return new File([blob], fileName, { type: mimeType });
    },
    staleTime: 10 * 60 * 1000,
  });
};

/**
 * Download file to user's computer
 */
export const downloadFile = async (
  source: string,
  fileName: string,
  options?: FetchOptions,
): Promise<void> => {
  const url = resolveUrl(source);

  const response: AxiosResponse<Blob> = await apiInstance.get(url, {
    responseType: 'blob',
    ...(options?.abortController && { signal: options.abortController.signal }),
  });

  const blob: Blob = response.data; // 👈 typed

  if (reactNativeBridge.isAvailable()) {
    try {
      const base64Data = await blobToBase64(blob);
      const mimeType =
        (response.headers?.['content-type'] as string | undefined) ||
        blob.type ||
        'application/octet-stream';
      const dispatched = reactNativeBridge.saveFileToDevice({
        fileName,
        mimeType,
        base64Data,
      });

      if (dispatched) {
        return;
      }
    } catch (error) {
      logger.warn(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_warn',
        message: String('[FileDownload] Failed to hand off file to native layer, falling back.'),
        context: [error],
      });
    }
  }

  const blobUrl = URL.createObjectURL(blob); // 👈 blob is safe

  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(blobUrl);
};

/**
 * Create blob URL for preview
 */
export const createPreviewUrl = async (
  source: string,
  options?: { forceRefresh?: boolean },
): Promise<Blob> => {
  const url = resolveUrl(source);

  if (options?.forceRefresh) {
    queryClient.removeQueries({ queryKey: ['preview-blob', url] });
  }

  return queryClient.fetchQuery<Blob>({
    queryKey: ['preview-blob', url],
    queryFn: async ({ signal }) => {
      const response = await apiInstance.get(url, {
        responseType: 'blob',
        signal,
      });
      const blob = response.data as Blob;
      if (!blob || blob.size === 0) {
        throw new Error('The file is empty or unavailable');
      }
      return blob;
    },
    staleTime: 10 * 60 * 1000,
  });
};

export const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        const [, base64 = ''] = result.split(',');
        resolve(base64);
      } else {
        reject(new Error('Unable to convert blob to base64'));
      }
    };
    reader.onerror = () => {
      reader.abort();
      reject(new Error('Failed to read blob data'));
    };
    reader.readAsDataURL(blob);
  });
};
