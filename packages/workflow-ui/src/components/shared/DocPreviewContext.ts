import { createContext, useContext } from 'react';
import type { Attachment } from '@xyne/workflow-sdk';

/**
 * When provided (by the origin panel), a document's "Preview" opens it as a tab
 * in that panel instead of a modal — so the reviewer keeps the fields in view
 * while comparing. Null everywhere else, so {@link AttachmentCard} falls back to
 * its own modal preview.
 */
export const DocPreviewContext = createContext<((attachment: Attachment) => void) | null>(null);

export function useDocPreview(): ((attachment: Attachment) => void) | null {
  return useContext(DocPreviewContext);
}
