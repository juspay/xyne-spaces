// ============================================================================
// FILE PILL COMPONENT
// ============================================================================
// Slack-style file pill for displaying file attachments in a compact row format
// ============================================================================

import React from 'react';
import {
  X,
  Download,
  FileText,
  Image,
  Video,
  Music,
  Archive,
  FileCode,
  Trash2,
} from 'lucide-react';
// Lucide has no PDF-specific glyph, so PDFs used to fall back to the same
// generic document sheet as Word/Excel/text. The design system ships one.
import { FilePdfFormat } from '@xyne/icons';
import { usePlatform } from '../../../hooks/usePlatform';
import { cn } from '../../../utils/classNames';
import { useAuth } from '../../../hooks/useAuth';

export interface FilePillProps {
  /** File name to display */
  fileName: string;
  /** MIME type for icon/color determination */
  mimeType: string;
  /** File size in bytes (optional) */
  fileSize?: number;
  /** Optional file ID for download/delete actions */
  fileId?: string;
  /** ID of user who uploaded the file */
  uploadedByUserId?: string;
  /** Click handler for the pill */
  onClick?: () => void;
  /** Remove handler (if provided, shows remove button) */
  onRemove?: () => void;
  /** Download handler (if provided, shows download button on hover) */
  onDownload?: () => void;
  /** Delete handler with proper permissions check */
  onDelete?: () => void;
  /** Whether the file is currently being uploaded */
  isUploading?: boolean;
  /** Custom class name */
  className?: string;
  /** File type label override (e.g., "PDF", "Plain Text") */
  typeLabel?: string;
}

/**
 * Format file size in human-readable format
 */
const formatFileSize = (bytes?: number): string => {
  if (!bytes || bytes === 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

interface FileTypeConfig {
  // Widened past `LucideIcon` so design-system glyphs can sit alongside the
  // lucide set — the pill only ever passes `className`.
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  textColor: string;
  label: string;
}

/**
 * Get file type configuration based on MIME type
 * Returns icon, color, and label for the file type
 */
const getFileTypeConfig = (mimeType: string, fileName: string): FileTypeConfig => {
  // Images
  if (mimeType.startsWith('image/')) {
    return {
      icon: Image,
      color: 'bg-blue-500',
      textColor: 'text-blue-500',
      label: 'Image',
    };
  }

  // Videos
  if (mimeType.startsWith('video/')) {
    return {
      icon: Video,
      color: 'bg-purple-500',
      textColor: 'text-purple-500',
      label: 'Video',
    };
  }

  // Audio
  if (mimeType.startsWith('audio/')) {
    return {
      icon: Music,
      color: 'bg-green-500',
      textColor: 'text-green-500',
      label: 'Audio',
    };
  }

  // PDF
  if (mimeType === 'application/pdf') {
    return {
      icon: FilePdfFormat,
      color: 'bg-red-500',
      textColor: 'text-red-500',
      label: 'PDF',
    };
  }

  // Word documents
  if (
    mimeType === 'application/msword' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return {
      icon: FileText,
      color: 'bg-blue-600',
      textColor: 'text-blue-600',
      label: 'Word',
    };
  }

  // Excel
  if (
    mimeType === 'application/vnd.ms-excel' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mimeType === 'text/csv'
  ) {
    return {
      icon: FileText,
      color: 'bg-green-600',
      textColor: 'text-green-600',
      label: 'Excel',
    };
  }

  // PowerPoint
  if (
    mimeType === 'application/vnd.ms-powerpoint' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ) {
    return {
      icon: FileText,
      color: 'bg-orange-500',
      textColor: 'text-orange-500',
      label: 'PowerPoint',
    };
  }

  // Archives
  if (
    mimeType === 'application/zip' ||
    mimeType === 'application/x-zip-compressed' ||
    mimeType === 'application/x-7z-compressed' ||
    mimeType === 'application/x-tar' ||
    mimeType === 'application/gzip' ||
    mimeType.includes('archive') ||
    mimeType.includes('compressed')
  ) {
    return {
      icon: Archive,
      color: 'bg-yellow-500',
      textColor: 'text-yellow-500',
      label: 'Archive',
    };
  }

  // Code files
  const codeExtensions = /\.(ts|tsx|js|jsx|py|rb|go|java|c|cpp|cs|sql|yml|yaml|json|md|html|css)$/i;
  if (
    codeExtensions.test(fileName) ||
    mimeType.includes('javascript') ||
    mimeType.includes('typescript') ||
    mimeType.includes('python') ||
    mimeType.includes('json') ||
    mimeType.includes('xml') ||
    mimeType.includes('yaml') ||
    mimeType.includes('sql')
  ) {
    return {
      icon: FileCode,
      color: 'bg-slate-500',
      textColor: 'text-slate-500',
      label: 'Code',
    };
  }

  // Plain text
  if (mimeType === 'text/plain' || fileName.endsWith('.txt')) {
    return {
      icon: FileText,
      color: 'bg-gray-500',
      textColor: 'text-gray-500',
      label: 'Plain Text',
    };
  }

  // Markdown
  if (mimeType === 'text/markdown' || fileName.endsWith('.md')) {
    return {
      icon: FileText,
      color: 'bg-gray-600',
      textColor: 'text-gray-600',
      label: 'Markdown',
    };
  }

  // Default
  return {
    icon: FileText,
    color: 'bg-gray-400',
    textColor: 'text-gray-400',
    label: 'File',
  };
};

/**
 * FilePill Component
 *
 * A Slack-style file attachment pill that displays:
 * - Colored icon based on file type
 * - Filename (truncated if too long)
 * - File type label
 * - Hover actions (download, remove, delete)
 */
export const FilePill: React.FC<FilePillProps> = ({
  fileName,
  mimeType,
  fileSize,
  uploadedByUserId,
  onClick,
  onRemove,
  onDownload,
  onDelete,
  isUploading = false,
  className,
  typeLabel,
}) => {
  const { isMobile } = usePlatform();
  const { user } = useAuth();
  const config = getFileTypeConfig(mimeType, fileName);
  const Icon = config.icon;

  // Check if current user can delete (owner or admin)
  const canDelete = uploadedByUserId && user?.id === uploadedByUserId;

  // Truncate filename if too long
  const displayName = fileName.length > 40 ? `${fileName.substring(0, 37)}...` : fileName;

  // Format size for display
  const sizeDisplay = formatFileSize(fileSize);

  return (
    <div
      className={cn(
        'group relative flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border bg-card',
        'hover:border-input hover:shadow-sm transition-all duration-200',
        'min-w-[200px] max-w-[320px]',
        onClick && 'cursor-pointer',
        isUploading && 'opacity-70',
        className,
      )}
      onClick={onClick}
      data-track-category='MESSAGE_ATTACHMENT'
      data-track-name='OPEN_FILE_PILL'
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      {/* File Icon */}
      <div
        className={cn(
          'flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center',
          config.color,
        )}
      >
        <Icon className='w-5 h-5 text-white' />
      </div>

      {/* File Info */}
      <div className='flex-1 min-w-0 flex flex-col gap-0.5'>
        <div className='text-sm font-medium text-foreground truncate' title={fileName}>
          {displayName}
        </div>
        <div className='text-xs text-muted-foreground flex items-center gap-1'>
          <span>{typeLabel || config.label}</span>
          {sizeDisplay && (
            <>
              <span className='text-border'>•</span>
              <span>{sizeDisplay}</span>
            </>
          )}
        </div>
      </div>

      {/* Actions - visible on hover (desktop) or always (mobile) */}
      <div
        className={cn(
          'flex items-center gap-1 flex-shrink-0',
          !isMobile && 'opacity-0 group-hover:opacity-100 transition-opacity duration-200',
        )}
      >
        {/* Download button */}
        {onDownload && !isUploading && (
          <button
            type='button'
            onClick={e => {
              e.stopPropagation();
              onDownload();
            }}
            data-track-category='MESSAGE_ATTACHMENT'
            data-track-name='DOWNLOAD_FILE_PILL'
            className='p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors'
            title='Download'
            aria-label={`Download ${fileName}`}
          >
            <Download className='w-4 h-4' />
          </button>
        )}

        {/* Delete button - only for owners */}
        {onDelete && canDelete && !isUploading && (
          <button
            type='button'
            onClick={e => {
              e.stopPropagation();
              onDelete();
            }}
            data-track-category='MESSAGE_ATTACHMENT'
            data-track-name='DELETE_FILE_PILL'
            className='p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors'
            title='Delete'
            aria-label={`Delete ${fileName}`}
          >
            <Trash2 className='w-4 h-4' />
          </button>
        )}

        {/* Remove button (for draft/preview only) */}
        {onRemove && !isUploading && (
          <button
            type='button'
            onClick={e => {
              e.stopPropagation();
              onRemove();
            }}
            data-track-category='MESSAGE_ATTACHMENT'
            data-track-name='REMOVE_FILE_PILL'
            className='p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors'
            title='Remove'
            aria-label={`Remove ${fileName}`}
          >
            <X className='w-4 h-4' />
          </button>
        )}
      </div>

      {/* Uploading indicator */}
      {isUploading && (
        <div className='absolute inset-0 flex items-center justify-center bg-background/80 rounded-lg'>
          <div className='w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin' />
        </div>
      )}
    </div>
  );
};
