import { useCallback, useEffect, useState } from 'react';
import type { SpeakerDiarizationStatus } from '../types/electron';

export interface SpeakerDiarizationSettings {
  /** True only inside the Electron desktop app. */
  isSupported: boolean;
  status: SpeakerDiarizationStatus | null;
  setEnabled: (enabled: boolean) => void;
  downloadModels: () => Promise<{ ok: boolean; error?: string }>;
  cancelDownload: () => void;
}

/**
 * Electron-only preference: on-device speaker diarization ("speaker
 * disambiguation") for note-taker recordings. Mirrors useRecordingPillSettings:
 * read once, subscribe to main-process status pushes, write on toggle.
 */
export const useSpeakerDiarizationSettings = (): SpeakerDiarizationSettings => {
  const api = window.electronAPI?.speakerDiarization;
  const isSupported = !!api;
  const [status, setStatus] = useState<SpeakerDiarizationStatus | null>(null);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void api
      .getStatus()
      .then(next => {
        if (!cancelled && next) setStatus(next);
      })
      .catch(() => undefined);
    const unsubscribe = api.onStatusChanged(next => {
      if (!cancelled) setStatus(next);
    });
    return (): void => {
      cancelled = true;
      unsubscribe();
    };
  }, [api]);

  const setEnabled = useCallback(
    (enabled: boolean): void => {
      if (!api) return;
      setStatus(prev => (prev ? { ...prev, enabled } : prev));
      api.setEnabled(enabled);
    },
    [api],
  );

  const downloadModels = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    if (!api) return { ok: false, error: 'Not supported' };
    return api.downloadModels();
  }, [api]);

  const cancelDownload = useCallback((): void => {
    api?.cancelDownload();
  }, [api]);

  return { isSupported, status, setEnabled, downloadModels, cancelDownload };
};
