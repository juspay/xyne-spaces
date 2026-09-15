import { useCallback, useMemo, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import {
  recordingService,
  type RecordingGoogleDocLink,
} from '../../services/Recording/recordingService';

const isGoogleDocLink = (value: unknown): value is RecordingGoogleDocLink =>
  !!value &&
  typeof value === 'object' &&
  typeof (value as RecordingGoogleDocLink).documentId === 'string' &&
  typeof (value as RecordingGoogleDocLink).url === 'string';

/** Docs already exported from this call, newest first, off the call row's metadata. */
const storedGoogleDocs = (metadata: unknown): RecordingGoogleDocLink[] => {
  const links = (metadata as Record<string, unknown> | null)?.['googleDocs'];
  return Array.isArray(links) ? links.filter(isGoogleDocLink) : [];
};

export interface CallGoogleDocExport {
  /** What the preview modal lists, so a second export is a deliberate choice. */
  documents: RecordingGoogleDocLink[];
  isExporting: boolean;
  /** Rejects so the preview modal can show why, matching the recordings contract. */
  exportDoc: (title?: string) => Promise<void>;
}

/** Creates a Google Doc from a call's summary and opens it in a new tab. */
export function useCallGoogleDocExport(
  externalId: string,
  metadata: unknown,
  onExported: () => void,
): CallGoogleDocExport {
  const [isExporting, setIsExporting] = useState(false);
  // The call this screen renders is usually the row Calls Home handed over in
  // navigation state, which never re-resolves from Zero, so a doc created here
  // is held until the screen is reopened — same reason the recordings screen
  // seeds its own list rather than waiting for the metadata write to come back.
  const [created, setCreated] = useState<RecordingGoogleDocLink[]>([]);

  const documents = useMemo(() => {
    const createdIds = new Set(created.map(document => document.documentId));
    return [...created, ...storedGoogleDocs(metadata).filter(d => !createdIds.has(d.documentId))];
  }, [created, metadata]);

  const exportDoc = useCallback(
    async (title?: string): Promise<void> => {
      if (isExporting) return;

      // Opened synchronously, or the browser treats the later navigation as a popup.
      const documentWindow = window.open('', '_blank');
      if (documentWindow) documentWindow.opener = null;

      setIsExporting(true);
      try {
        const { documentUrl, document: createdDocument } = await recordingService.exportGoogleDoc(
          externalId,
          title,
          false,
        );
        if (documentWindow) {
          documentWindow.location.assign(documentUrl);
        } else {
          window.open(documentUrl, '_blank', 'noopener,noreferrer');
        }
        if (createdDocument) {
          setCreated(prev => [
            createdDocument,
            ...prev.filter(entry => entry.documentId !== createdDocument.documentId),
          ]);
        }
        toast.success('Google Doc created');
        onExported();
      } catch (error) {
        documentWindow?.close();
        toast.error('Failed to export to Google Docs', {
          description: axios.isAxiosError<{ error?: string }>(error)
            ? (error.response?.data?.error ?? error.message)
            : 'Please try again.',
        });
        throw error;
      } finally {
        setIsExporting(false);
      }
    },
    [externalId, isExporting, onExported],
  );

  return { documents, isExporting, exportDoc };
}
