import { ReactElement } from 'react';
import { SlideContent, type FileItem } from './FileViewerModal';
import { FileSearchProvider, FileSearchControls } from './search';

interface AttachmentPreviewPaneProps {
  attachmentId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
}

// Prop-driven single-file preview for the search right-pane. Reuses the modal's
// inner viewer (SlideContent) without the gallery / actor / modal shell. Search
// results carry the attachment metadata but not the download URL, so build it here.
export function AttachmentPreviewPane({
  attachmentId,
  fileName,
  mimeType,
  fileSize,
}: AttachmentPreviewPaneProps): ReactElement {
  const file: FileItem = {
    fileName,
    fileUrl: `${ATTACHMENT_DOWNLOAD_ROUTE}/${attachmentId}/download`,
    mimeType,
    fileSize,
    attachmentId,
  };
  return (
    <FileSearchProvider resetKey={attachmentId}>
      <div className='flex-1 min-h-0 flex flex-col overflow-hidden'>
        <FileSearchControls />
        <div className='flex-1 min-h-0 overflow-auto flex items-center justify-center p-3'>
          <SlideContent file={file} isActive />
        </div>
      </div>
    </FileSearchProvider>
  );
}

const ATTACHMENT_DOWNLOAD_ROUTE = '/attachments';
