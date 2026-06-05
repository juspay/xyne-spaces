import React, { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, Loader2, CheckCircle2 } from 'lucide-react';
import { useFileUpload, type UploadedFile } from '../../../hooks/useFileUpload';

interface UploadDropZoneProps {
  collectionId?: string | undefined;
  onUploadComplete?: ((fileIds: string[]) => void) | undefined;
}

interface StoredFile {
  id: string;
  collectionId?: string;
}

/**
 * Upload Drop Zone Component
 * Handles file drag & drop and upload
 */
export const UploadDropZone: React.FC<UploadDropZoneProps> = ({
  collectionId,
  onUploadComplete,
}) => {
  const { uploadFiles, uploads } = useFileUpload();
  const [isUploading, setIsUploading] = useState(false);

  const onDrop = useCallback(
    async (acceptedFiles: File[]): Promise<void> => {
      if (acceptedFiles.length === 0) return;

      setIsUploading(true);

      // Start uploads with collectionId
      await uploadFiles(acceptedFiles, { ...(collectionId && { collectionId }) });

      // Wait for all uploads to complete (upload simulation takes ~2.1 seconds per file)
      const totalWaitTime = acceptedFiles.length * 2100 + 500; // Add buffer

      setTimeout(() => {
        // Get completed upload IDs from localStorage (more reliable than state)
        try {
          const storedData = localStorage.getItem('kb_test_files');
          if (!storedData) {
            setIsUploading(false);
            return;
          }

          const parsedData: unknown = JSON.parse(storedData);

          // Type guard to ensure it's an array
          if (!Array.isArray(parsedData)) {
            setIsUploading(false);
            return;
          }

          // Type guard to ensure each item has the expected structure
          const storedFiles = parsedData.filter((item): item is StoredFile => {
            return (
              typeof item === 'object' &&
              item !== null &&
              'id' in item &&
              typeof (item as StoredFile).id === 'string'
            );
          });

          const completedIds: string[] = storedFiles
            .filter(f => !collectionId || f.collectionId === collectionId)
            .map(f => f.id);

          setIsUploading(false);
          if (completedIds.length > 0 && onUploadComplete) {
            onUploadComplete(completedIds);
          }
        } catch {
          setIsUploading(false);
        }
      }, totalWaitTime);
    },
    [uploadFiles, collectionId, onUploadComplete],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (acceptedFiles: File[]) => {
      void onDrop(acceptedFiles);
    },
    multiple: true,
  });

  // Type-safe uploads - hook returns UploadedFile[]
  const safeUploads: UploadedFile[] = uploads;

  const activeUploads = safeUploads.filter(u => u.status !== 'ready');
  const completedUploads = safeUploads.filter(u => u.status === 'ready');

  return (
    <div className='space-y-4'>
      <div
        {...getRootProps()}
        className={`
          border-2 border-dashed rounded-lg p-8 text-center cursor-pointer
          transition-colors
          ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}
          ${
            isDragActive
              ? 'border-blue-500 bg-blue-50'
              : 'border-gray-300 hover:border-gray-400 bg-gray-50'
          }
        `}
      >
        <input
          {...getInputProps()}
          disabled={isUploading}
          data-track-category='knowledge-base'
          data-track-name='upload-files'
        />
        {isUploading ? (
          <Loader2 size={32} className='mx-auto mb-3 text-blue-500 animate-spin' />
        ) : (
          <Upload
            size={32}
            className={`mx-auto mb-3 ${isDragActive ? 'text-blue-500' : 'text-gray-400'}`}
          />
        )}
        <p className='text-sm font-medium text-gray-700 mb-1'>
          {isUploading
            ? 'Uploading files...'
            : isDragActive
              ? 'Drop files here'
              : 'Drag & drop files here'}
        </p>
        <p className='text-xs text-gray-500'>
          {isUploading ? 'Please wait' : 'or click to select files'}
        </p>
      </div>

      {/* Upload Progress */}
      {activeUploads.length > 0 && (
        <div className='space-y-2'>
          <p className='text-sm font-medium text-gray-700'>Uploading:</p>
          {activeUploads.map(upload => (
            <div key={upload.id} className='bg-gray-50 rounded p-3'>
              <div className='flex items-center justify-between mb-2'>
                <span className='text-sm text-gray-700 truncate flex-1'>{upload.name}</span>
                <span className='text-xs text-gray-500 ml-2'>{upload.progress}%</span>
              </div>
              <div className='w-full bg-gray-200 rounded-full h-2'>
                <div
                  className='bg-blue-500 h-2 rounded-full transition-all duration-300'
                  style={{ width: `${upload.progress}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Completed Uploads */}
      {completedUploads.length > 0 && activeUploads.length === 0 && (
        <div className='flex items-center gap-2 text-sm text-green-600'>
          <CheckCircle2 size={16} />
          <span>{completedUploads.length} file(s) uploaded successfully!</span>
        </div>
      )}
    </div>
  );
};
