import React from 'react';
import { FileText, Image, File, Video, Music, Folder, FolderOpen } from 'lucide-react';
import { NodeType } from '../../../services/Knowledge/collectionService';

interface FileIconProps {
  /** Node type: FOLDER or FILE */
  nodeType: NodeType;
  /** MIME type for files (used to determine specific icon) */
  mimeType?: string;
  /** Whether folder is expanded (only applies to FOLDER type) */
  isExpanded?: boolean;
  /** Icon size in pixels */
  size?: number;
  /** Variant: 'tree' for tree view, 'card' for file cards */
  variant?: 'tree' | 'card';
}

/**
 * Unified icon component for files and folders
 * Supports both tree view and file card view
 */
export const FileIcon: React.FC<FileIconProps> = ({
  nodeType,
  mimeType,
  isExpanded = false,
  size,
  variant = 'tree',
}) => {
  const iconSize = size ?? (variant === 'card' ? 32 : 16);

  // Handle folders
  if (nodeType === 'FOLDER') {
    const folderIcon = isExpanded ? (
      <FolderOpen size={iconSize} className='text-blue-500 flex-shrink-0' />
    ) : (
      <Folder size={iconSize} className='text-blue-500 flex-shrink-0' />
    );

    if (variant === 'card') {
      return (
        <div className='flex-shrink-0 p-2 bg-gray-50 rounded'>
          <Folder size={iconSize} className='text-gray-500' />
        </div>
      );
    }

    return folderIcon;
  }

  // Handle files - determine icon based on MIME type
  const getFileIcon = () => {
    const mimeTypeLower = mimeType?.toLowerCase() ?? '';

    if (mimeTypeLower.startsWith('image/')) {
      return <Image size={iconSize} className='text-blue-500' />;
    }
    if (mimeTypeLower.startsWith('video/')) {
      return <Video size={iconSize} className='text-purple-500' />;
    }
    if (mimeTypeLower.startsWith('audio/')) {
      return <Music size={iconSize} className='text-green-500' />;
    }
    if (mimeTypeLower.includes('pdf')) {
      return <File size={iconSize} className='text-red-500' />;
    }
    if (mimeTypeLower.includes('markdown') || mimeTypeLower.includes('text')) {
      return <FileText size={iconSize} className='text-gray-600' />;
    }
    // Default file icon
    return <FileText size={iconSize} className='text-gray-500' />;
  };

  const fileIcon = getFileIcon();

  if (variant === 'card') {
    return <div className='flex-shrink-0 p-2 bg-gray-50 rounded'>{fileIcon}</div>;
  }

  return <div className='flex-shrink-0'>{fileIcon}</div>;
};
