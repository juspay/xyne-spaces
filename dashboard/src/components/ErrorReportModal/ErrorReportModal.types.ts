import type { ScreenSource } from '../../types/electron';

export interface ErrorReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  pendingRecording?: File | null;
  pendingRecordingFilePath?: string | null;
  onSourceSelected?: (source: ScreenSource, withMic: boolean) => void;
  onSubmitSuccess?: () => void;
  onDiscard?: () => void;
}
