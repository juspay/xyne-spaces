import React, { useState, useMemo } from 'react';
import { X } from 'lucide-react';
import Dialog from '../../ui/Dialog';
import { Breadcrumb } from '../shared/Breadcrumb';
import { FileUploadZone } from './FileUploadZone';
import { NodeType, uploadFilesInBatches } from '../../../services/Knowledge/collectionService';
import { CollectionTreeNode } from '../tree/treeTypes';
import { useProjectCollections } from '../hooks/useProjectCollections';
import { useUploadHandler } from './useUploadHandler';

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  collectionId: string;
  collectionName?: string | undefined;
  onUploadComplete?: ((uploadPath: (string | null)[]) => void) | undefined;
}

export const UploadModal: React.FC<UploadModalProps> = ({
  isOpen,
  onClose,
  collectionId,
  collectionName,
  onUploadComplete,
}) => {
  const { nodes, currentFolderId } = useProjectCollections();

  const { initUpload, createProgressCallback, completeUpload, handleError } = useUploadHandler();

  const [files, setFiles] = useState<File[]>([]);

  const breadcrumbPath = useMemo(() => {
    if (!currentFolderId) {
      return [];
    }

    const path: Array<{ id: string; name: string }> = [];
    let currentId: string | null = currentFolderId;
    const visited = new Set<string>();

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const node = nodes[currentId] as CollectionTreeNode;
      if (node) {
        path.unshift({ id: node.id, name: node.name });
        currentId = node.parentId;
      } else {
        break;
      }
    }

    return path;
  }, [currentFolderId, nodes]);

  const uploadPath = useMemo(() => {
    if (!currentFolderId) {
      return [null];
    }
    return [null, ...breadcrumbPath.map(item => item.id), currentFolderId];
  }, [currentFolderId, breadcrumbPath]);

  const handleUpload = (): void => {
    if (files.length === 0) return;

    const parentId =
      currentFolderId === null || String(currentFolderId) === String(collectionId)
        ? null
        : currentFolderId;

    // ── Init tracking → overlay appears immediately ────────────────
    const { uploadId, sessionId, batches } = initUpload(
      collectionId,
      collectionName || 'Unknown Collection',
      files,
    );
    const progressCallback = createProgressCallback(uploadId, files, batches);

    // ── Close modal — user can continue working ────────────────────
    const filesToUpload = files;
    setFiles([]);
    onClose();

    // ── Upload in background (fire-and-forget) ─────────────────────
    uploadFilesInBatches(
      collectionId,
      filesToUpload,
      parentId,
      'rename',
      progressCallback,
      sessionId,
    )
      .then(result => {
        completeUpload(uploadId, {
          totalUploaded: result.totalUploaded,
          totalSkipped: result.totalSkipped,
          totalFailed: result.totalFailed,
        });

        onUploadComplete?.(uploadPath);
      })
      .catch((err: unknown) => {
        handleError(uploadId, err);
      });
  };

  const handleClose = (): void => {
    setFiles([]);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <div className='p-6 max-w-3xl w-full max-h-[80vh] flex flex-col'>
        {/* Header */}
        <div className='flex items-center justify-between mb-4'>
          <div>
            <h2 className='text-xl font-semibold text-gray-900'>Upload Files</h2>
            <p className='text-sm text-gray-500 mt-1'>
              {collectionName ? `To: ${collectionName}` : 'Upload to current location'}
            </p>
          </div>
          <button
            onClick={handleClose}
            data-track-category='knowledge-base'
            data-track-name='close-modal'
            className='p-2 rounded-md hover:bg-gray-100 transition-colors'
          >
            <X size={20} className='text-gray-500' />
          </button>
        </div>

        {/* Breadcrumb - Read-only, shows current upload destination */}
        <Breadcrumb
          rootItem={{
            id: collectionId,
            name: collectionName || 'Collection',
            type: 'FOLDER' as NodeType,
          }}
          items={breadcrumbPath.map(item => ({
            id: item.id,
            name: item.name,
            type: 'FOLDER' as NodeType,
          }))}
          limit={3}
        />

        {/* File Upload Zone */}
        <div className='mb-4'>
          <FileUploadZone
            files={files}
            onFilesChange={setFiles}
            disabled={!collectionId}
            showInfo={false}
          />
        </div>

        {/* Upload Button */}
        <div className='flex justify-end'>
          <button
            onClick={handleUpload}
            disabled={files.length === 0 || !collectionId}
            data-track-category='knowledge-base'
            data-track-name='upload-files'
            className='px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
          >
            Upload {files.length > 0 && `(${files.length})`}
          </button>
        </div>
      </div>
    </Dialog>
  );
};
