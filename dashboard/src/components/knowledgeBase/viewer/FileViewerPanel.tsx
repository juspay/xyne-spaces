import React, { useState, useEffect, useMemo, useRef } from 'react';
import { FileViewerHeader } from './FileViewerHeader';
import { Breadcrumb } from '../shared/Breadcrumb';
import { ArrowLeft } from 'lucide-react';
import { Button } from '../../ui/Button';
import { detectFileType, FILE_TYPE_CONFIG } from '../../FileViewer/utils';
import { fetchFile, downloadFile } from '../../../services/clients/fileFetchService';
import { useProjectCollections } from '../hooks/useProjectCollections';
import { NodeType } from '../../../services/Knowledge/collectionService';
import { CollectionTreeNode } from '../tree/treeTypes';

export const FileViewerPanel: React.FC<{
  handleBackNavigation: () => void;
  fileId: string | undefined;
  onOpenChat?: (docId: string, docName: string) => void;
}> = ({ handleBackNavigation, fileId, onOpenChat }) => {
  const [fileData, setFileData] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [containerWidth, setContainerWidth] = useState<number | undefined>(undefined);
  const contentRef = useRef<HTMLDivElement>(null);
  const fileIdRef = useRef<string | undefined>(fileId);
  fileIdRef.current = fileId;
  const { activeCollection, nodes } = useProjectCollections();
  const collectionId = activeCollection?.id ?? null;

  useEffect(() => {
    const updateWidth = () => {
      if (contentRef.current) {
        setContainerWidth(contentRef.current.clientWidth);
      }
    };

    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  const getFileTypeFromMimeType = (mimeType: string): string | null => {
    // Return mime type directly if it's not the generic octet-stream
    if (mimeType && mimeType !== 'application/octet-stream') {
      return mimeType;
    }
    return null;
  };

  const getFileTypeFromName = (fileName: string): string => {
    const extension = fileName.split('.').pop()?.toLowerCase() || '';
    const mimeTypes: Record<string, string> = {
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ppt: 'application/vnd.ms-powerpoint',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      txt: 'text/plain',
      md: 'text/markdown',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      csv: 'text/csv',
    };
    return mimeTypes[extension] || 'application/octet-stream';
  };

  const file = useMemo(() => {
    if (!fileId || !nodes[fileId]) {
      return null;
    }

    const node = nodes[fileId];
    const mimeType = node.mimeType || '';
    const name = node.name || '';

    const fileType = getFileTypeFromMimeType(mimeType) || getFileTypeFromName(name);

    return {
      id: fileId,
      name,
      type: fileType,
      size: node.size || 0,
      mimeType,
    };
  }, [fileId, nodes]);

  const [fileForId, setFileForId] = useState<{ file: File; fileId: string } | null>(null);

  useEffect(() => {
    if (!fileId) {
      setFileForId(null);
      setFileData(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    setFileForId(null);
    setFileData(null);
    const requestedFileId = fileId;

    const loadFile = async (): Promise<void> => {
      try {
        const fetched = await fetchFile(
          `/collections/items/${requestedFileId}/download`,
          file?.name ?? requestedFileId,
          file?.mimeType ?? 'application/octet-stream',
        );
        if (requestedFileId !== fileIdRef.current) return;
        setFileForId({ file: fetched, fileId: requestedFileId });
      } catch {
        if (requestedFileId !== fileIdRef.current) return;
        setError('Failed to load file. Please try again.');
        setFileForId(null);
        setFileData(null);
      } finally {
        if (requestedFileId === fileIdRef.current) {
          setIsLoading(false);
        }
      }
    };

    void loadFile();
  }, [fileId]);

  useEffect(() => {
    if (fileForId && fileForId.fileId === fileId) {
      setFileData(fileForId.file);
    } else {
      setFileData(null);
    }
  }, [fileForId, fileId]);

  const currentCollectionId = collectionId;

  const fileParentId = useMemo(() => {
    if (!fileId || !nodes[fileId]) return null;
    return nodes[fileId].parentId;
  }, [fileId, nodes]);

  const breadcrumbPath = useMemo(() => {
    if (!fileParentId) {
      return [];
    }

    const path: Array<{ id: string; name: string }> = [];
    let currentId: string | null = fileParentId;
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
  }, [fileParentId, nodes]);

  if (!file) {
    return (
      <div className='h-full flex items-center justify-center'>
        <div className='text-center'>
          <p className='text-gray-500'>No file selected</p>
          <Button
            variant='outline'
            className='mt-4'
            onClick={() => {
              handleBackNavigation();
            }}
          >
            <ArrowLeft size={16} />
            Back to Collections
          </Button>
        </div>
      </div>
    );
  }

  const fileType = detectFileType(file.type, file.name);

  const renderContent = (): React.ReactElement | null => {
    if (isLoading) {
      return (
        <div className='flex items-center justify-center h-full'>
          <div className='text-center'>
            <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-2'></div>
            <p className='text-gray-500'>Loading file...</p>
          </div>
        </div>
      );
    }

    if (error) {
      return (
        <div className='flex items-center justify-center h-full'>
          <div className='text-center'>
            <p className='text-red-500 mb-4'>{error}</p>
            <Button
              variant='outline'
              onClick={() => {
                handleBackNavigation();
              }}
            >
              <ArrowLeft size={16} />
              Back
            </Button>
          </div>
        </div>
      );
    }

    if (!fileType || !fileData) {
      return (
        <div className='flex items-center justify-center h-full'>
          <div className='text-center text-gray-500'>
            <p>Preview not available for this file type</p>
          </div>
        </div>
      );
    }

    // Use the existing viewer components
    const config = FILE_TYPE_CONFIG[fileType.type];

    if (!config) {
      return (
        <div className='flex items-center justify-center h-full'>
          <div className='text-center text-gray-500'>
            <p>Preview not available for this file type</p>
          </div>
        </div>
      );
    }

    const ViewerComponent = config.component;

    return (
      <div
        className={`${config.wrapperClass} bg-white max-w-full max-h-full ${fileType.type === 'text' ? 'pt-[65px]' : ''}`}
      >
        <ViewerComponent
          source={fileData}
          fileName={file.name}
          {...(containerWidth ? { width: containerWidth } : {})}
        />
      </div>
    );
  };

  const handleDownload = async (): Promise<void> => {
    try {
      if (!fileId || !file) return;
      await downloadFile(`/collections/items/${fileId}/download`, file.name);
    } catch {
      setError('Failed to download file. Please try again.');
    }
  };

  return (
    <div className='h-full flex flex-col bg-white' ref={contentRef}>
      <Breadcrumb
        rootItem={{
          id: currentCollectionId || null,
          name: 'Collection',
          type: 'FOLDER' as NodeType,
        }}
        items={[
          ...breadcrumbPath.map(item => ({
            id: item.id,
            name: item.name,
            type: 'FOLDER' as NodeType,
          })),
          { id: file.id, name: file.name, type: 'FILE' as NodeType },
        ]}
        limit={10}
      />
      <div className='flex-1 overflow-auto bg-gray-50 relative'>
        <FileViewerHeader
          file={file}
          onDownload={() => {
            void handleDownload();
          }}
          onOpenChat={onOpenChat ? () => onOpenChat(file.id, file.name) : undefined}
        />
        {renderContent()}
      </div>
    </div>
  );
};
