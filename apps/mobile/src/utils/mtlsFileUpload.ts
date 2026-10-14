/**
 * mTLS File Upload Utility for React Native
 *
 * Provides multipart/form-data file uploads over mTLS connections.
 * Uses mtlsFetch for direct mTLS communication without proxy.
 */

import { getResponseText, mtlsFetch } from './mtlsHttpClient';

export interface MultipartFile {
  uri: string;
  name: string;
  type: string;
}

export interface ThumbnailFile {
  uri: string;
  name: string;
  type: string;
}

export interface MtlsMultipartUploadOptions {
  url: string;
  fields?: Record<string, string | string[]>;
  files: MultipartFile[];
  thumbnails?: ThumbnailFile[];
  headers?: Record<string, string>;
  allowRepeatedFields?: boolean;
}

export interface MtlsUploadResponse {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
}

/**
 * Build a FormData object from fields, files, and optional thumbnails.
 * React Native FormData requires { uri, type, name } objects for files.
 */
function buildFormData(
  fields: Record<string, string | string[]>,
  files: MultipartFile[],
  thumbnails?: ThumbnailFile[],
): FormData {
  const formData = new FormData();

  // Add fields — arrays are appended as repeated keys so multer parses them as string[].
  Object.entries(fields).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach(v => formData.append(key, v));
    } else {
      formData.append(key, value);
    }
  });

  // Add files
  for (const file of files) {
    formData.append('files', {
      uri: file.uri,
      type: file.type,
      name: file.name,
    } as unknown as Blob);
  }

  // Add thumbnails if provided (for video/document previews)
  if (thumbnails) {
    for (const thumb of thumbnails) {
      if (thumb.uri) {
        formData.append('thumbnails', {
          uri: thumb.uri,
          type: thumb.type,
          name: thumb.name,
        } as unknown as Blob);
      } else {
        // Empty thumbnail placeholder for files without thumbnails
        formData.append('thumbnails', '');
      }
    }
  }

  return formData;
}

/**
 * Perform a multipart/form-data upload over mTLS.
 *
 * Uses mtlsFetch for direct mTLS communication, eliminating the need for a proxy.
 */
export async function mtlsMultipartUpload(
  options: MtlsMultipartUploadOptions,
): Promise<MtlsUploadResponse> {
  const { url, fields = {}, files, thumbnails, headers = {}, allowRepeatedFields } = options;

  // Build FormData for upload
  const formData = buildFormData(fields, files, thumbnails);

  // eslint-disable-next-line no-console
  console.log('[mtlsMultipartUpload] Uploading via mtlsFetch:', url, {
    fieldKeys: Object.keys(fields),
    hasChannelId: typeof fields['channelId'] === 'string' && fields['channelId'].length > 0,
    hasDraftMessageId:
      typeof fields['draftMessageId'] === 'string' && fields['draftMessageId'].length > 0,
    fileCount: files.length,
    thumbnailCount: thumbnails?.length ?? 0,
  });

  // Use mtlsFetch for direct mTLS communication (handles both local and protected hosts)
  const response = await mtlsFetch(url, {
    method: 'POST',
    body: formData,
    headers,
    ...(allowRepeatedFields !== undefined && { allowRepeatedFields }),
  });

  // Decode base64 response body if needed. Non-base64 JSON responses may already come back
  // as a parsed object — getResponseText restrings it so callers can keep treating `body` as
  // a JSON string.
  return {
    statusCode: response.statusCode,
    body: getResponseText(response),
    headers: response.headers as Record<string, string>,
  };
}

/**
 * Check if multipart mTLS upload is available.
 * Returns true since mtlsFetch handles mTLS natively.
 */
export function isMtlsMultipartUploadAvailable(): boolean {
  return true;
}
