import React, { useState, useRef, useCallback, useEffect, DragEvent, ChangeEvent } from 'react';
import { Upload, FolderOpen, X } from 'lucide-react';
import { Button } from '../../ui/Button/Button';
import { cn } from '../../../utils/classNames';
import { formatFileSize, getFileExtension, getExtensionColor } from '../../ui/utils/files';

interface FileUploadZoneProps {
  files: File[];
  onFilesChange: (files: File[]) => void;
  disabled?: boolean;
  maxFiles?: number;
  showInfo?: boolean;
  /** If true, only allow folder selection. */
  folderOnly?: boolean;
}

/**
 * Reusable File Upload Zone Component
 * Handles drag & drop, file/folder selection, and file list display
 */
export const FileUploadZone: React.FC<FileUploadZoneProps> = ({
  files,
  onFilesChange,
  disabled = false,
  maxFiles,
  showInfo = true,
  folderOnly = false,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Set webkitdirectory attribute via ref
  useEffect(() => {
    if (folderInputRef.current) {
      folderInputRef.current.setAttribute('webkitdirectory', '');
      folderInputRef.current.setAttribute('directory', '');
    }
  }, []);

  const addFiles = useCallback(
    (newFiles: File[]) => {
      const combined = [...files, ...newFiles];
      if (maxFiles && combined.length > maxFiles) {
        onFilesChange(combined.slice(0, maxFiles));
      } else {
        onFilesChange(combined);
      }
    },
    [files, maxFiles, onFilesChange],
  );

  const removeFile = useCallback(
    (index: number) => {
      onFilesChange(files.filter((_, i) => i !== index));
    },
    [files, onFilesChange],
  );

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragEnter = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (!disabled) {
        setIsDragging(true);
      }
    },
    [disabled],
  );

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      if (disabled) return;

      const droppedFiles = Array.from(e.dataTransfer.files);
      if (droppedFiles.length > 0) {
        addFiles(droppedFiles);
      }
    },
    [disabled, addFiles],
  );

  const handleFileSelect = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = Array.from(e.target.files || []);
      if (selectedFiles.length > 0) {
        addFiles(selectedFiles);
      }
      // Reset input so the same file can be re-selected
      e.target.value = '';
    },
    [addFiles],
  );

  const handleDropZoneKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!disabled) {
          if (folderOnly) {
            folderInputRef.current?.click();
          } else {
            fileInputRef.current?.click();
          }
        }
      }
    },
    [disabled, folderOnly],
  );

  return (
    <div className='space-y-4'>
      {/* Drag & Drop Zone */}
      <div
        role='button'
        tabIndex={disabled ? -1 : 0}
        aria-label='Upload files by clicking or dragging and dropping'
        data-track-category='knowledge-base'
        data-track-name='upload-zone'
        className={cn(
          'border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors',
          disabled
            ? 'border-gray-200 bg-gray-50 cursor-not-allowed opacity-50'
            : isDragging
              ? 'border-blue-500 bg-blue-50'
              : 'border-gray-300 hover:border-gray-400',
        )}
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => {
          if (disabled) return;
          if (folderOnly) {
            folderInputRef.current?.click();
          } else {
            fileInputRef.current?.click();
          }
        }}
        onKeyDown={handleDropZoneKeyDown}
      >
        <Upload size={32} className='mx-auto text-gray-400 mb-3' />
        <p className='text-sm font-medium text-gray-700'>
          {folderOnly ? 'Drag & drop a folder here' : 'Drag & drop files or folders here'}
        </p>
        <p className='text-xs text-gray-500 mt-1'>
          {folderOnly ? 'or click to select a folder' : 'or click to select files'}
        </p>
        {showInfo && (
          <p className='text-xs text-gray-400 mt-2'>
            All file types supported. Only DOCX, PDF, and MD files will be searchable.
          </p>
        )}
      </div>

      {/* Hidden File Inputs */}
      <input
        ref={fileInputRef}
        type='file'
        multiple
        onChange={handleFileSelect}
        disabled={disabled}
        className='hidden'
      />
      <input
        ref={folderInputRef}
        type='file'
        multiple
        onChange={handleFileSelect}
        disabled={disabled}
        className='hidden'
      />

      {/* Action Buttons - only show when NOT folder-only */}
      {!folderOnly && (
        <div className='flex justify-between'>
          <Button
            variant='outline'
            onClick={e => {
              e.stopPropagation();
              if (!disabled) {
                folderInputRef.current?.click();
              }
            }}
            data-track-category='knowledge-base'
            data-track-name='OPEN_FILE_PICKER'
            disabled={disabled}
          >
            <FolderOpen size={16} />
            Select Folder
          </Button>
        </div>
      )}

      {/* Selected Files List */}
      {files.length > 0 && (
        <div>
          <p className='text-sm font-medium text-gray-700 mb-2'>
            Selected files ({files.length}
            {maxFiles ? `/${maxFiles}` : ''})
          </p>
          <div className='space-y-1.5 max-h-48 overflow-auto'>
            {files.map((file, index) => (
              <div
                key={`${file.name}-${file.size}-${index}`}
                className='flex items-center justify-between p-2 bg-gray-50 rounded-lg'
              >
                <div className='flex items-center gap-2 min-w-0'>
                  <span
                    className={cn(
                      'text-[10px] font-bold text-white px-1.5 py-0.5 rounded flex-shrink-0',
                      getExtensionColor(file.name),
                    )}
                  >
                    {getFileExtension(file.name)}
                  </span>
                  <span className='text-sm text-gray-700 truncate'>{file.name}</span>
                  <span className='text-xs text-gray-400 flex-shrink-0'>
                    {formatFileSize(file.size)}
                  </span>
                </div>
                <button
                  onClick={() => removeFile(index)}
                  disabled={disabled}
                  data-track-category='knowledge-base'
                  data-track-name='remove-file'
                  className='p-1 hover:bg-red-50 rounded transition-colors flex-shrink-0 disabled:opacity-50'
                >
                  <X size={14} className='text-gray-400 hover:text-red-500' />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
