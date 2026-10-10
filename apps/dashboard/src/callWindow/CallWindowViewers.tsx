import type { ReactElement } from 'react';
import { AttachmentGalleryModal } from '../components/FileViewer/FileViewerModal';
import { AttachmentCitationPreview } from '../components/FileViewer/AttachmentCitationPreview';
import { ThreadCitationModal } from '../components/xyne-desk/ThreadCitationModal/ThreadCitationModal';
import { TranscriptCitationModal } from '../components/Chat/TranscriptCitationModal';

/**
 * The viewers the call's chat opens (attachments, citations), as the main app
 * mounts them. Their own module so the call window loads them separately,
 * behind the call: they bring the file viewers with them.
 */
export default function CallWindowViewers(): ReactElement {
  return (
    <>
      <AttachmentGalleryModal />
      <AttachmentCitationPreview />
      <ThreadCitationModal />
      <TranscriptCitationModal />
    </>
  );
}
