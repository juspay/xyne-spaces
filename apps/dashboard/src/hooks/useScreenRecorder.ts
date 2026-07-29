import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { ScreenSource } from '../types/electron';

export type ScreenRecorderState = 'idle' | 'recording';

export interface UseScreenRecorderReturn {
  recordingState: ScreenRecorderState;
  recordingSeconds: number;
  startRecording: (source: ScreenSource, withMic?: boolean) => Promise<void>;
  stopRecording: () => void;
}

export function useScreenRecorder(
  onRecordingComplete: (file: File, filePath: string) => void,
): UseScreenRecorderReturn {
  const [recordingState, setRecordingState] = useState<ScreenRecorderState>('idle');
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  const unsubscribeRef = useRef<(() => void) | null>(null);

  const finalizeRecording = useCallback(
    async (filePath: string, recordingToken: string): Promise<void> => {
      const electronAPI = window.electronAPI;
      if (!electronAPI?.readErrorReportRecordingFile) {
        return;
      }

      try {
        const blob = await electronAPI.readErrorReportRecordingFile(recordingToken);
        const file = new File([blob], 'screen-recording.webm', { type: 'video/webm' });

        onRecordingComplete(file, filePath);
      } catch (err) {
        toast.error('Failed to process recording', {
          description: err instanceof Error ? err.message : 'Please try again.',
        });
      }
    },
    [onRecordingComplete],
  );

  useEffect(() => {
    const checkExistingRecording = async (): Promise<void> => {
      const electronAPI = window.electronAPI;
      if (!electronAPI?.getErrorReportRecordingState) return;

      try {
        const state = await electronAPI.getErrorReportRecordingState();

        if (state.state === 'recording') {
          setRecordingState('recording');
          setRecordingSeconds(state.elapsedSeconds ?? 0);

          if (electronAPI.onErrorReportRecordingProgress) {
            unsubscribeRef.current = electronAPI.onErrorReportRecordingProgress(data => {
              setRecordingSeconds(data.elapsedSeconds);
            });
          }
        }
      } catch {
        /* Silent fail - IPC not available */
      }
    };

    void checkExistingRecording();

    return (): void => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, []);

  const stopRecording = useCallback((): void => {
    const electronAPI = window.electronAPI;

    if (!electronAPI?.stopErrorReportRecording) {
      return;
    }

    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }

    electronAPI
      .stopErrorReportRecording()
      .then(({ filePath, recordingToken }) => finalizeRecording(filePath, recordingToken))
      .catch((err: unknown) => {
        toast.error('Failed to stop recording', {
          description: err instanceof Error ? err.message : 'Please try again.',
        });
      })
      .finally(() => {
        setRecordingState('idle');
        setRecordingSeconds(0);
      });
  }, [finalizeRecording]);

  const startRecording = useCallback(
    async (source: ScreenSource, withMic = false): Promise<void> => {
      const electronAPI = window.electronAPI;

      if (!electronAPI?.startErrorReportRecording) {
        toast.error('Recording not available');
        return;
      }

      try {
        await electronAPI.startErrorReportRecording(source.id, withMic);

        setRecordingState('recording');
        setRecordingSeconds(0);

        if (electronAPI.onErrorReportRecordingProgress) {
          if (unsubscribeRef.current) {
            unsubscribeRef.current();
          }

          unsubscribeRef.current = electronAPI.onErrorReportRecordingProgress(data => {
            setRecordingSeconds(data.elapsedSeconds);
          });
        }
      } catch (err) {
        setRecordingState('idle');
        toast.error('Failed to start recording', {
          description: err instanceof Error ? err.message : 'Please try again.',
        });
      }
    },
    [],
  );

  return { recordingState, recordingSeconds, startRecording, stopRecording };
}
