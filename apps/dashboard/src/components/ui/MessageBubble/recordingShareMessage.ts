import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { queries } from '../../../zero/queries';
import { useQuery } from '../../../hooks/useQuery';

export interface ParsedRecordingShareMessage {
  recordingId: string;
  title: string;
  noteHtml: string;
}

/**
 * Recognises the HTML emitted by the recording share flows. The recording's
 * external id is already present in the detail-page URL, so this deliberately
 * avoids relying on message metadata (channel/DM shares do not have any).
 */
export const parseRecordingShareMessage = (content: string): ParsedRecordingShareMessage | null => {
  if (!content || typeof DOMParser === 'undefined') return null;

  const doc = new DOMParser().parseFromString(content, 'text/html');
  const links = Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href]'));

  for (const link of links) {
    const recordingBlock = link.closest('p');
    const titleElement = recordingBlock?.querySelector('strong');
    if (!recordingBlock || !titleElement) continue;

    if (link.textContent?.trim().toLowerCase() !== 'view recording') continue;

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(link.getAttribute('href') ?? '', 'http://localhost');
    } catch {
      continue;
    }

    const pathMatch = parsedUrl.pathname.match(/\/recordings\/([^/?#]+)\/?$/);
    if (!pathMatch?.[1]) continue;

    const title = titleElement.textContent?.trim();
    if (!title) continue;

    let recordingId: string;
    try {
      recordingId = decodeURIComponent(pathMatch[1]);
    } catch {
      continue;
    }
    if (!recordingId || recordingId.includes('/')) continue;

    recordingBlock.remove();

    return {
      recordingId,
      title,
      noteHtml: doc.body.innerHTML.trim(),
    };
  }

  return null;
};

export interface ResolvedRecordingShareMessage extends ParsedRecordingShareMessage {
  displayTitle: string;
  durationMs: number | null;
  openRecording: () => void;
}

/** Resolves generated recording-share HTML into live Zero data and navigation. */
export const useRecordingShareMessage = (
  content: string | null | undefined,
): ResolvedRecordingShareMessage | null => {
  const navigate = useNavigate();
  const parsed = useMemo(() => (content ? parseRecordingShareMessage(content) : null), [content]);
  const [recording] = useQuery(
    queries.oatsRecordingByExternalId({ callId: parsed?.recordingId ?? '' }),
    { enabled: !!parsed },
  );
  const recordingId = parsed?.recordingId;
  const openRecording = useCallback((): void => {
    if (!recordingId) return;
    void navigate(`/recordings/${recordingId}`);
  }, [navigate, recordingId]);

  return useMemo(() => {
    if (!parsed) return null;

    return {
      ...parsed,
      displayTitle: recording?.title?.trim() || parsed.title,
      durationMs:
        typeof recording?.endedAt === 'number'
          ? Math.max(0, recording.endedAt - recording.startedAt)
          : null,
      openRecording,
    };
  }, [openRecording, parsed, recording]);
};
