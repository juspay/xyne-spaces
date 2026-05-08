import React, { useState, useEffect, useMemo, useRef } from 'react';
import { FileViewerHeader } from './FileViewerHeader';
import { Breadcrumb } from '../shared/Breadcrumb';
import { ArrowLeft } from 'lucide-react';
import { Button } from '../../ui/Button';
import { detectFileType, FILE_TYPE_CONFIG } from '../../FileViewer/utils';
import { getFileContent } from '../../../services/Knowledge/collectionService';
import { useCollectionTree, CollectionTreeNode } from '../context/CollectionTreeContext';
import { NodeType } from '../../../services/Knowledge/collectionService';

/**
 * File Viewer Panel Component
 * Displays the selected file content using existing FileViewer components
 */
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
  const { nodes, collectionId } = useCollectionTree();

  // Measure container width for responsive PDF scaling
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

  // Helper function to determine file type from mime type
  const getFileTypeFromMimeType = (mimeType: string): string | null => {
    // Return mime type directly if it's not the generic octet-stream
    if (mimeType && mimeType !== 'application/octet-stream') {
      return mimeType;
    }
    return null;
  };

  // Helper function to determine file type from name (fallback)
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

  // Derive file metadata from nodes (reactive - updates when nodes change)
  const file = useMemo(() => {
    if (!fileId || !nodes[fileId]) {
      return null;
    }

    const node = nodes[fileId];
    const mimeType = node.mimeType || '';
    const name = node.name || '';

    // Determine file type from mime type or name
    const fileType = getFileTypeFromMimeType(mimeType) || getFileTypeFromName(name);

    return {
      id: fileId,
      name,
      type: fileType,
      size: node.size || 0,
      mimeType,
    };
  }, [fileId, nodes]);

  // Store blob with the fileId it belongs to so we never show wrong file (e.g. DOCX bytes as PDF)
  const [blobForFile, setBlobForFile] = useState<{ blob: Blob; fileId: string } | null>(null);

  // Load file content (blob) from API - only when fileId changes
  useEffect(() => {
    if (!fileId) {
      setBlobForFile(null);
      setFileData(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    setBlobForFile(null);
    setFileData(null);
    const requestedFileId = fileId;

    const loadFile = async (): Promise<void> => {
      try {
        const { blob } = await getFileContent(requestedFileId);
        if (requestedFileId !== fileIdRef.current) return;
        setBlobForFile({ blob, fileId: requestedFileId });
      } catch {
        if (requestedFileId !== fileIdRef.current) return;
        setError('Failed to load file. Please try again.');
        setBlobForFile(null);
        setFileData(null);
      } finally {
        if (requestedFileId === fileIdRef.current) {
          setIsLoading(false);
        }
      }
    };

    void loadFile();
  }, [fileId]);

  // Build File for viewer only when blob belongs to current file (avoids wrong content after navigation)
  useEffect(() => {
    if (blobForFile && blobForFile.fileId === fileId && file) {
      const fileObj = new File([blobForFile.blob], file.name, { type: file.mimeType });
      setFileData(fileObj);
    } else {
      setFileData(null);
    }
  }, [blobForFile, fileId, file?.name, file?.mimeType]);

  // Get collectionId from context
  const currentCollectionId = collectionId;

  // Get file's parentId (folderId) from context nodes
  const fileParentId = useMemo(() => {
    if (!fileId || !nodes[fileId]) return null;
    return nodes[fileId].parentId;
  }, [fileId, nodes]);

  // Build breadcrumb path from file's parent folder up to collection root
  const breadcrumbPath = useMemo(() => {
    if (!fileParentId) {
      return [];
    }

    const path: Array<{ id: string; name: string }> = [];
    let currentId: string | null = fileParentId;
    const visited = new Set<string>();

    // Build path by traversing up parentId chain using context nodes
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const node = nodes[currentId] as CollectionTreeNode;
      if (node) {
        path.unshift({ id: node.id, name: node.name });
        currentId = node.parentId;
      } else {
        // Node not found in context - break to avoid infinite loop
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
      const { blob } = await getFileContent(fileId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
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
