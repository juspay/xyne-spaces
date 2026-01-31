// ============================================================================
// ATTACHMENTS COMPONENT
// ============================================================================
// Display file attachments with preview functionality using shared context
// Shows thumbnail previews and opens full-screen viewer on click
// ============================================================================

import React, { useState } from 'react';
import { AttachmentPreview } from './AttachmentPreview';
import { MediaViewer } from './MediaViewer';
import { useDragDropFiles } from '../../../contexts/DragDropFileContext';
// 1. Import the shared type
import type { AttachmentsProps as BaseAttachmentsProps } from './Files.types';

type AttachmentsProps = Pick<
  BaseAttachmentsProps,
  'isUploading' | 'showDownload' | 'onThumbnailGenerated'
> & {
  id: string;
  onPreview?: (file: File) => void;
};

export const Attachments: React.FC<AttachmentsProps> = ({
  id,
  onPreview,
  isUploading = false,
  showDownload = false,
  onThumbnailGenerated,
}) => {
  const { droppedFiles: attachments, removeDroppedFile: removeAttachment } = useDragDropFiles();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isViewerOpen, setIsViewerOpen] = useState(false);

  const currentFiles = React.useMemo(() => {
    return (id ? attachments[id] : []) || [];
  }, [attachments, id]);

  if (currentFiles.length === 0) return null;

  const handlePreview = (file: File): void => {
    setSelectedFile(file);
    setIsViewerOpen(true);
    onPreview?.(file);
  };

  const handleCloseViewer = (): void => {
    setIsViewerOpen(false);
    setSelectedFile(null);
  };

  return (
    <>
      <div className='px-3 py-2 flex flex-wrap gap-3'>
        {currentFiles.map((file, index) => (
          <AttachmentPreview
            key={`${file.name}-${index}`}
            file={file}
            onRemove={() => removeAttachment(id, file)}
            onPreview={() => handlePreview(file)}
            isUploading={isUploading}
            {...(onThumbnailGenerated && { onThumbnailGenerated })}
          />
        ))}
      </div>

      {/* Full-screen Media Viewer */}
      {selectedFile && (
        <MediaViewer
          file={selectedFile}
          isOpen={isViewerOpen}
          onClose={handleCloseViewer}
          showDownload={showDownload}
        />
      )}
    </>
  );
};
