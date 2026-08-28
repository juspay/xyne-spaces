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

/**
 * Docs already exported from this call, newest first. They live on the call row
 * (utils/recordingGoogleDocs writes them there), so Zero keeps the list current
 * without this screen tracking exports of its own.
 */
export function useCallGoogleDocs(metadata: unknown): RecordingGoogleDocLink[] {
  return useMemo(() => {
    const links = (metadata as Record<string, unknown> | null)?.['googleDocs'];
    return Array.isArray(links) ? links.filter(isGoogleDocLink) : [];
  }, [metadata]);
}

export interface CallGoogleDocExport {
  isExporting: boolean;
  /** Rejects so the preview modal can show why, matching the recordings contract. */
  exportDoc: (title?: string) => Promise<void>;
}

/** Creates a Google Doc from a call's summary and opens it in a new tab. */
export function useCallGoogleDocExport(
  externalId: string,
  onExported: () => void,
): CallGoogleDocExport {
  const [isExporting, setIsExporting] = useState(false);

  const exportDoc = useCallback(
    async (title?: string): Promise<void> => {
      if (isExporting) return;

      // Opened synchronously, or the browser treats the later navigation as a popup.
      const documentWindow = window.open('', '_blank');
      if (documentWindow) documentWindow.opener = null;

      setIsExporting(true);
      try {
        const { documentUrl } = await recordingService.exportGoogleDoc(externalId, title, false);
        if (documentWindow) {
          documentWindow.location.assign(documentUrl);
        } else {
          window.open(documentUrl, '_blank', 'noopener,noreferrer');
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

  return { isExporting, exportDoc };
}
