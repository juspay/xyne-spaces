import React from 'react';
import { BASE_URL } from '../../../services/clients/apiClient';
import { recordingService } from '../../../services/Recording/recordingService';

interface InlineVideoPreviewProps {
  callId: string;
  recordingId?: string;
  /** The recording's own attachment row, when the message has one. */
  attachmentId?: string;
}

/**
 * Inline player for a call recording posted in a thread.
 *
 * Prefers the shared range-request stream endpoint — the same one VideoViewer
 * uses for every other video — and keeps the legacy blob download as a fallback
 * for messages that predate the recording's attachment row.
 */
export function InlineVideoPreview({
  callId,
  recordingId,
  attachmentId,
}: InlineVideoPreviewProps): React.ReactElement {
  const [blobUrl, setBlobUrl] = React.useState<string | null>(null);
  const [streamFailed, setStreamFailed] = React.useState(false);
  const blobUrlRef = React.useRef<string | null>(null);

  // Every recording posts its own attachment row, so the range-request stream
  // endpoint can serve the file: playback starts on the first chunk and seeking
  // works, instead of waiting for the whole recording to download. If that
  // request fails the effect below falls back to the blob download.
  const streamUrl =
    attachmentId && !streamFailed ? `${BASE_URL}/attachments/${attachmentId}/stream` : null;

  React.useEffect(() => {
    // Streaming path needs no blob — skip the download entirely.
    if (streamUrl) return;
    let cancelled = false;
    // Per-recording download when we have a recordingId; fall back to the legacy
    // latest-recording path for older messages that predate the field.
    const fetchBlob = recordingId
      ? recordingService.downloadCallRecordingBlob(callId, recordingId)
      : recordingService.downloadRecordingBlob(callId);
    fetchBlob
      .then(blob => {
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url;
        setBlobUrl(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, [callId, recordingId, streamUrl]);

  const src = streamUrl ?? blobUrl;
  if (!src) return <></>;
  return (
    <video
      src={src}
      // Credentialed CORS matches what the stream route's middleware serves —
      // API_BASE_URL is a different origin in dev and in the desktop app. These
      // are meaningless on a blob: URL, so the fallback stays as it was.
      {...(streamUrl
        ? {
            crossOrigin: 'use-credentials' as const,
            preload: 'metadata',
            onError: () => setStreamFailed(true),
          }
        : {})}
      controls
      className='mt-2 rounded-md max-w-sm w-full'
      style={{ maxHeight: '240px' }}
    >
      <track kind='captions' />
    </video>
  );
}
