import { useEffect, useState } from 'react';

export function useCameraPreview(enabled: boolean): MediaStream | null {
  const [stream, setStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    if (!enabled || !navigator.mediaDevices?.getUserMedia) return;

    let cancelled = false;
    let acquired: MediaStream | null = null;

    navigator.mediaDevices
      .getUserMedia({ video: true })
      .then(media => {
        if (cancelled) {
          media.getTracks().forEach(track => track.stop());
          return;
        }
        acquired = media;
        setStream(media);
      })
      .catch(() => {
        // No permission or no camera — the card simply shows no preview.
      });

    return (): void => {
      cancelled = true;
      acquired?.getTracks().forEach(track => track.stop());
      setStream(null);
    };
  }, [enabled]);

  return stream;
}
