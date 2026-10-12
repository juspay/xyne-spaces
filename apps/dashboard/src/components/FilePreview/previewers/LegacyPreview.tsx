import type { ReactElement } from 'react';
import { AttachmentPreviewPane } from '../../FileViewer/AttachmentPreviewPane';
import type { PreviewerProps } from '../types';

/**
 * PDFs, Word documents and slides, drawn by the viewers the rest of the app previews
 * attachments with, until they get previewers of their own here: documents and
 * slides as PDFs the server makes, in one PDF previewer. Those viewers fetch the
 * file themselves.
 */
export default function LegacyPreview(props: PreviewerProps): ReactElement {
  return (
    <div className='flex h-full min-h-0 flex-col'>
      <AttachmentPreviewPane
        attachmentId={props.file.id}
        fileName={props.file.name}
        mimeType={props.file.mimetype}
        fileSize={props.file.size}
        flush
      />
    </div>
  );
}
