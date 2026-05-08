import React, { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import Dialog from '../../ui/Dialog';
import { FileUploadZone } from './FileUploadZone';
import { CollectionChild, uploadNewVersion } from '../../../services/Knowledge/collectionService';
import { toast } from 'sonner';

interface ReplaceFileModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: CollectionChild;
  collectionId: string;
  onSuccess: () => void;
}

/**
 * Replace File Modal
 * Allows users to upload a new version of an existing file.
 * The current version is preserved in version history.
 */
export const ReplaceFileModal: React.FC<ReplaceFileModalProps> = ({
  isOpen,
  onClose,
  item,
  onSuccess,
}) => {
  const [files, setFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const handleReplace = async (): Promise<void> => {
    if (files.length === 0 || !files[0]) return;

    setIsUploading(true);
    setUploadProgress(0);

    try {
      await uploadNewVersion(item.id, files[0], percent => {
        setUploadProgress(percent);
      });
      toast.success(`"${item.name}" replaced successfully`);
      onSuccess();
    } catch (error) {
      console.error('Failed to replace file:', error);
      toast.error('Failed to replace file. Please try again.');
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const handleClose = (): void => {
    if (isUploading) return;
    setFiles([]);
    setUploadProgress(0);
    onClose();
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={open => {
        if (!open) handleClose();
      }}
      title={
        <div className='flex items-center gap-2'>
          <RefreshCw size={16} className='text-gray-500' />
          <span>Replace — {item.name}</span>
        </div>
      }
    >
      <div className='flex flex-col gap-4 p-4'>
        <p className='text-sm text-gray-600'>
          Upload a new version of this file. The current version will be saved to version history.
        </p>

        <FileUploadZone
          files={files}
          onFilesChange={setFiles}
          maxFiles={1}
          disabled={isUploading}
          showInfo={false}
        />

        {isUploading && (
          <div className='flex flex-col gap-1'>
            <div className='flex justify-between text-xs text-gray-500'>
              <span>Uploading...</span>
              <span>{uploadProgress}%</span>
            </div>
            <div className='w-full bg-gray-200 rounded-full h-1.5'>
              <div
                className='bg-blue-500 h-1.5 rounded-full transition-all duration-300'
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        )}

        <div className='flex justify-end gap-2'>
          <button
            onClick={handleClose}
            disabled={isUploading}
            className='px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50'
            data-track-category='knowledge-base'
            data-track-name='replace-file-cancel'
          >
            Cancel
          </button>
          <button
            onClick={() => void handleReplace()}
            disabled={files.length === 0 || isUploading}
            className='flex items-center gap-2 px-4 py-2 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed'
            data-track-category='knowledge-base'
            data-track-name='replace-file-confirm'
          >
            <RefreshCw size={14} />
            {isUploading ? 'Uploading...' : 'Replace'}
          </button>
        </div>
      </div>
    </Dialog>
  );
};
