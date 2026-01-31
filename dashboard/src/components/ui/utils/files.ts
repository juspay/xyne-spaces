// ============================================================================
// FILE UTILITIES
// ============================================================================
// Shared utilities for file type detection, formatting, and validation
// ============================================================================

/**
 * File type categories for UI rendering
 */
export type FileCategory =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'csv'
  | 'text'
  | 'document'
  | 'archive';

/**
 * Allowed file types for upload (matches backend validation)
 * Kept in sync with backend/src/services/fileValidationService.ts
 */
export const ALLOWED_FILE_TYPES = [
  // Images
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  // Documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // Text files
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/xml',
  'text/xml',
  // Archive files
  'application/zip',
  'application/x-7z-compressed',
  'application/x-tar',
  'application/gzip',
  // Video files
  'video/mp4',
  'video/webm',
  'video/avi',
  'video/quicktime',
  // Audio files
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/mp3',
] as const;

/**
 * Extension to color mapping for file badges
 */
const EXTENSION_COLORS: Record<string, string> = {
  pdf: 'bg-red-600',
  doc: 'bg-blue-600',
  docx: 'bg-blue-600',
  xls: 'bg-green-600',
  xlsx: 'bg-green-600',
  ppt: 'bg-orange-600',
  pptx: 'bg-orange-600',
  txt: 'bg-gray-600',
  md: 'bg-gray-600',
  csv: 'bg-teal-600',
  json: 'bg-purple-600',
  zip: 'bg-yellow-600',
  rar: 'bg-yellow-600',
};

/**
 * Get file category based on MIME type and extension
 */
export const getFileCategory = (file: { type: string; name: string | undefined }): FileCategory => {
  const type = file.type || '';
  const name = file.name ? file.name.toLowerCase() : '';

  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (type === 'text/csv' || name.endsWith('.csv')) return 'csv';
  if (
    type.startsWith('text/') ||
    name.endsWith('.txt') ||
    name.endsWith('.json') ||
    name.endsWith('.md')
  ) {
    return 'text';
  }
  if (name.endsWith('.zip') || name.endsWith('.rar')) return 'archive';

  return 'document';
};

/**
 * Check if file can be viewed in browser
 */
export const isBrowserSupported = (file: File): boolean => {
  const category = getFileCategory(file);
  return ['image', 'video', 'audio', 'pdf', 'csv', 'text'].includes(category);
};

/**
 * Get file extension in uppercase
 */
export const getFileExtension = (fileName: string | undefined): string => {
  if (!fileName) return 'FILE';
  const ext = fileName.split('.').pop()?.toUpperCase();
  return ext || 'FILE';
};

/**
 * Get color class for file extension badge
 */
export const getExtensionColor = (fileName: string | undefined): string => {
  if (!fileName) return 'bg-gray-600';
  const ext = fileName.split('.').pop()?.toLowerCase();
  return ext ? EXTENSION_COLORS[ext] || 'bg-gray-600' : 'bg-gray-600';
};

/**
 * Truncate filename to fit in small preview
 */
export const truncateFileName = (name: string | undefined, maxLength: number = 12): string => {
  if (!name) return 'file';
  if (name.length <= maxLength) return name;

  const ext = name.split('.').pop();
  const nameWithoutExt = name.substring(0, name.lastIndexOf('.'));
  const truncated = nameWithoutExt.substring(0, maxLength - (ext ? ext.length + 4 : 3));

  return ext ? `${truncated}...${ext}` : `${truncated}...`;
};

/**
 * Parse CSV content into 2D array
 */
export const parseCSV = (text: string): string[][] => {
  return text.split('\n').map(row => row.split(',').map(cell => cell.trim()));
};

/**
 * Format file size to human-readable string
 */
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
};

/**
 * Dimensions extracted from a media file
 */
export interface FileDimensions {
  width: number;
  height: number;
}

/**
 * Extract dimensions from an image file using browser Image API
 */
const getImageDimensions = (file: File): Promise<FileDimensions> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = (): void => {
      const dimensions: FileDimensions = {
        width: img.naturalWidth,
        height: img.naturalHeight,
      };
      URL.revokeObjectURL(objectUrl);
      resolve(dimensions);
    };

    img.onerror = (): void => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Failed to load image: ${file.name}`));
    };

    img.src = objectUrl;
  });
};

/**
 * Extract dimensions from a video file using browser Video API
 */
const getVideoDimensions = (file: File): Promise<FileDimensions> => {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const objectUrl = URL.createObjectURL(file);

    video.onloadedmetadata = (): void => {
      const dimensions: FileDimensions = {
        width: video.videoWidth,
        height: video.videoHeight,
      };
      URL.revokeObjectURL(objectUrl);
      resolve(dimensions);
    };

    video.onerror = (): void => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Failed to load video: ${file.name}`));
    };

    video.src = objectUrl;
  });
};

/**
 * Extract dimensions from a file (image or video)
 * Returns null for non-media files (documents, audio, etc.)
 *
 * @param file - The file to extract dimensions from
 * @returns Promise<FileDimensions | null> - Dimensions or null if not applicable
 *
 * @example
 * const file = inputElement.files[0];
 * const dimensions = await getFileDimensions(file);
 * if (dimensions) {
 *   console.log(`${dimensions.width}x${dimensions.height}`);
 * }
 */
export const getFileDimensions = async (file: File): Promise<FileDimensions | null> => {
  const category = getFileCategory(file);

  try {
    if (category === 'image') {
      return await getImageDimensions(file);
    }

    if (category === 'video') {
      return await getVideoDimensions(file);
    }

    // Documents, audio, archives, etc. don't have visual dimensions
    return null;
  } catch {
    // Failed to extract dimensions, return null gracefully
    return null;
  }
};

/**
 * Extract dimensions from multiple files in parallel
 *
 * @param files - Array of files to extract dimensions from
 * @returns Promise<Map<File, FileDimensions | null>> - Map of file to dimensions
 *
 * @example
 * const files = Array.from(inputElement.files);
 * const dimensionsMap = await getFilesDimensions(files);
 * files.forEach(file => {
 *   const dims = dimensionsMap.get(file);
 *   console.log(file.name, dims?.width, dims?.height);
 * });
 */
export const getFilesDimensions = async (
  files: File[],
): Promise<Map<File, FileDimensions | null>> => {
  const results = await Promise.all(
    files.map(async file => {
      const dimensions = await getFileDimensions(file);
      return { file, dimensions };
    }),
  );

  const dimensionsMap = new Map<File, FileDimensions | null>();
  results.forEach(({ file, dimensions }) => {
    dimensionsMap.set(file, dimensions);
  });

  return dimensionsMap;
};

/**
 * Validate file against constraints
 */
export interface FileValidation {
  isValid: boolean;
  error?: string;
}

export const validateFile = (
  file: File,
  options: {
    maxSize?: number; // in bytes
    allowedTypes?: string[];
  } = {},
): FileValidation => {
  const { maxSize, allowedTypes } = options;

  // Check file size
  if (maxSize && file.size > maxSize) {
    return {
      isValid: false,
      error: `File size exceeds ${formatFileSize(maxSize)}`,
    };
  }

  // Check file type
  if (allowedTypes && allowedTypes.length > 0) {
    const fileExt = file.name.split('.').pop()?.toLowerCase();
    const mimeType = file.type;

    const isAllowed = allowedTypes.some(
      type =>
        mimeType === type ||
        mimeType.startsWith(type.replace('*', '')) ||
        (fileExt && type === `.${fileExt}`),
    );

    if (!isAllowed) {
      return {
        isValid: false,
        error: 'File type not allowed',
      };
    }
  }

  return { isValid: true };
};
