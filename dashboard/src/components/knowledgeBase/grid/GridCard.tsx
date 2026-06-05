import React from 'react';
import { MoreVertical, Download, Trash2, Pencil, RefreshCw, History } from 'lucide-react';
import { FileIcon } from '../shared/FileIcon';
import { GridCardMetadata } from './GridCardMetadata';
import { IngestionStatusBadge } from '../shared/UploadStatusBadge';
import { NodeType } from '../../../services/Knowledge/collectionService';
import { IngestionStatus } from '@xyne/shared';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';

export interface GridCardData {
  id: string;
  name: string;
  type: NodeType;
  size: number;
  updatedAt: string;
  status: IngestionStatus | null;
  mimeType: string;
}

interface GridCardProps {
  file: GridCardData;
  onClick: () => void;
  onDoubleClick?: (() => void) | undefined;
  onRename?: () => void;
  onDelete?: () => void;
  onDownload?: () => void;
  onReplace?: () => void;
  onVersionHistory?: () => void;
}

/**
 * Grid Card Component
 * Displays a single file or folder in the file list
 */
export const GridCard: React.FC<GridCardProps> = ({
  file,
  onClick,
  onDoubleClick,
  onRename,
  onDelete,
  onDownload,
  onReplace,
  onVersionHistory,
}) => {
  return (
    <div
      className='
        bg-white border rounded-lg p-4 cursor-pointer
        hover:shadow-md hover:border-blue-300 transition-all
        flex flex-col gap-2 relative
        select-none
      '
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      role='button'
      tabIndex={0}
      data-track-category='knowledge-base'
      data-track-name='open-file'
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className='flex items-start justify-between gap-2'>
        <FileIcon nodeType={file.type} mimeType={file.mimeType} variant='card' />
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              onClick={e => e.stopPropagation()}
              className='p-2 rounded-full hover:bg-blue-100 transition-colors'
              aria-label='File options'
              data-track-category='knowledge-base'
              data-track-name='file-options'
            >
              <MoreVertical size={16} className='text-gray-500' />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' className='w-40'>
            <DropdownMenuItem
              onClick={e => {
                e.stopPropagation();
                onDownload?.();
              }}
              className='flex items-center gap-2 cursor-pointer'
              disabled={!onDownload}
            >
              <Download size={14} className='text-gray-500' />
              Download
            </DropdownMenuItem>
            {file.type === 'FILE' && (
              <>
                <DropdownMenuItem
                  onClick={e => {
                    e.stopPropagation();
                    onReplace?.();
                  }}
                  className='flex items-center gap-2 cursor-pointer'
                  disabled={!onReplace}
                >
                  <RefreshCw size={14} className='text-gray-500' />
                  Replace
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={e => {
                    e.stopPropagation();
                    onVersionHistory?.();
                  }}
                  className='flex items-center gap-2 cursor-pointer'
                  disabled={!onVersionHistory}
                >
                  <History size={14} className='text-gray-500' />
                  Version History
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuItem
              onClick={e => {
                e.stopPropagation();
                onRename?.();
              }}
              className='flex items-center gap-2 cursor-pointer'
              disabled={!onRename}
            >
              <Pencil size={14} className='text-gray-500' />
              Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={e => {
                e.stopPropagation();
                onDelete?.();
              }}
              className='flex items-center gap-2 cursor-pointer text-red-600 focus:text-red-600 focus:bg-red-50'
              disabled={!onDelete}
            >
              <Trash2 size={14} />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className='flex-1'>
        <h3 className='font-medium text-sm text-gray-900 truncate mb-1'>{file.name}</h3>
        <div className='flex items-end justify-between'>
          <GridCardMetadata file={file} />
          {file.type === 'FILE' ? (
            <IngestionStatusBadge status={file.status} variant='compact' />
          ) : (
            <div className='w-6 h-6' />
          )}
        </div>
      </div>
    </div>
  );
};
