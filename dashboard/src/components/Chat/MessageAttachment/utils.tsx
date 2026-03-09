/**
 * File utilities for handling file operations, formatting, and type detection
 * Extracted from MessageAttachment component for reusability
 */

import { FileText, Image, Video, Music, Archive } from 'lucide-react';
import { downloadFile } from '../../../services/clients/fileFetchService';
import { JSX } from 'react/jsx-runtime';

/**
 * MIME type to file extension mapping
 * Used for displaying file type badges and icons
 */
/* eslint-disable @typescript-eslint/naming-convention */
const MIME_TO_EXTENSION: Record<string, string> = {
  // Images
  'image/jpeg': 'JPG',
  'image/jpg': 'JPG',
  'image/png': 'PNG',
  'image/gif': 'GIF',
  'image/webp': 'WEBP',
  'image/svg+xml': 'SVG',
  'image/bmp': 'BMP',
  'image/tiff': 'TIFF',
  'image/ico': 'ICO',

  // Videos
  'video/mp4': 'MP4',
  'video/avi': 'AVI',
  'video/mov': 'MOV',
  'video/wmv': 'WMV',
  'video/webm': 'WEBM',
  'video/mkv': 'MKV',
  'video/flv': 'FLV',

  // Audio
  'audio/mp3': 'MP3',
  'audio/wav': 'WAV',
  'audio/ogg': 'OGG',
  'audio/aac': 'AAC',
  'audio/flac': 'FLAC',

  // Documents
  'application/pdf': 'PDF',
  'application/msword': 'DOC',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/vnd.ms-excel': 'XLS',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  'application/vnd.ms-powerpoint': 'PPT',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX',
  'text/plain': 'TXT',
  'text/csv': 'CSV',
  'text/rtf': 'RTF',

  // Archives
  'application/zip': 'ZIP',
  'application/x-rar-compressed': 'RAR',
  'application/x-7z-compressed': '7Z',
  'application/x-tar': 'TAR',
  'application/gzip': 'GZ',

  // Code files
  'text/javascript': 'JS',
  'application/javascript': 'JS',
  'text/typescript': 'TS',
  'text/css': 'CSS',
  'text/html': 'HTML',
  'application/json': 'JSON',
  'text/xml': 'XML',
  'application/xml': 'XML',
};

/**
 * Get file extension from MIME type
 * Returns a human-readable file extension for display
 */
export const getFileExtension = (mimeType: string): string => {
  return MIME_TO_EXTENSION[mimeType] || 'FILE';
};

/**
 * Format file size in human-readable format
 * Converts bytes to appropriate unit (B, KB, MB, GB, TB)
 */
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  if (bytes < 0) return 'Unknown size';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const size = bytes / Math.pow(k, i);

  // Show decimal places for smaller files
  const decimals = i === 0 ? 0 : size < 10 ? 1 : 0;

  return `${size.toFixed(decimals)} ${units[i]}`;
};

/**
 * Intelligently truncate filename while preserving extension
 * Ensures the extension is always visible for file recognition
 */
export const truncateFileName = (fileName: string, maxLength: number = 25): string => {
  if (fileName.length <= maxLength) return fileName;

  const lastDotIndex = fileName.lastIndexOf('.');

  // If no extension found, just truncate normally
  if (lastDotIndex === -1 || lastDotIndex === 0) {
    return `${fileName.substring(0, maxLength - 3)}...`;
  }

  const extension = fileName.substring(lastDotIndex);
  const nameWithoutExt = fileName.substring(0, lastDotIndex);

  // Reserve space for "..." and extension
  const availableSpace = maxLength - 3 - extension.length;

  if (availableSpace <= 0) {
    // If extension is too long, just show extension
    return `...${extension}`;
  }

  return `${nameWithoutExt.substring(0, availableSpace)}...${extension}`;
};

/**
 * Check if file type is an image based on MIME type
 */
export const isImageFile = (mimeType: string): boolean => {
  return mimeType.startsWith('image/');
};

/**
 * Check if file type is a video based on MIME type
 */
export const isVideoFile = (mimeType: string): boolean => {
  return mimeType.startsWith('video/');
};

/**
 * Check if file type is an audio file based on MIME type
 */
export const isAudioFile = (mimeType: string): boolean => {
  return mimeType.startsWith('audio/');
};

/**
 * Check if file type is a document based on MIME type
 */
export const isDocumentFile = (mimeType: string): boolean => {
  return mimeType.startsWith('application/') || mimeType.startsWith('text/');
};

/**
 * Get file category for grouping and icon selection
 */
export const getFileCategory = (
  mimeType: string,
): 'image' | 'video' | 'audio' | 'document' | 'archive' | 'unknown' => {
  if (isImageFile(mimeType)) return 'image';
  if (isVideoFile(mimeType)) return 'video';
  if (isAudioFile(mimeType)) return 'audio';
  if (
    mimeType.includes('zip') ||
    mimeType.includes('rar') ||
    mimeType.includes('7z') ||
    mimeType.includes('tar')
  ) {
    return 'archive';
  }
  if (isDocumentFile(mimeType)) return 'document';
  return 'unknown';
};

/**
 * Validate file size against limits
 */
export const validateFileSize = (
  fileSize: number,
  maxSizeInMB: number = 50,
): { valid: boolean; error?: string } => {
  const maxSizeInBytes = maxSizeInMB * 1024 * 1024;

  if (fileSize > maxSizeInBytes) {
    return {
      valid: false,
      error: `File size (${formatFileSize(fileSize)}) exceeds the maximum limit of ${maxSizeInMB}MB`,
    };
  }

  return { valid: true };
};

/**
 * Generate a safe download filename
 * Removes potentially dangerous characters
 */
export const sanitizeFileName = (fileName: string): string => {
  return fileName
    .replace(/[<>:"/\\|?*]/g, '_') // Replace invalid characters
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .replace(/_{2,}/g, '_'); // Replace multiple underscores with single
};

/**
 * Download an attachment file by ID
 * Uses shared service for API call
 */
export const downloadAttachment = async (attachmentId: string, fileName: string): Promise<void> => {
  // Import the service function dynamically to avoid circular imports
  return downloadFile(attachmentId, fileName);
};

/**
 * Get appropriate icon component based on file category
 */
export const getFileIcon = (mimeType: string, size = 16): JSX.Element => {
  const category = getFileCategory(mimeType);
  const iconProps = { size, className: 'text-muted-foreground' };

  switch (category) {
    case 'image':
      return <Image {...iconProps} className='text-blue-500' />;
    case 'video':
      return <Video {...iconProps} className='text-red-500' />;
    case 'audio':
      return <Music {...iconProps} className='text-green-500' />;
    case 'archive':
      return <Archive {...iconProps} className='text-orange-500' />;
    default:
      return <FileText {...iconProps} />;
  }
};
