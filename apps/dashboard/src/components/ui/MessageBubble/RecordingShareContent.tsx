import type { ReactElement, ReactNode } from 'react';
import { RecordingSharePill } from './RecordingSharePill';
import type { ResolvedRecordingShareMessage } from './recordingShareMessage';

interface RecordingShareContentProps {
  recordingShare: ResolvedRecordingShareMessage;
  renderNote?: (noteHtml: string) => ReactNode;
  className?: string;
  showPill?: boolean;
  afterContent?: ReactNode;
}

/**
 * Keeps recording-share note and pill composition consistent while allowing
 * each message surface to retain its own HTML renderer and layout constraints.
 */
export const RecordingShareContent = ({
  recordingShare,
  renderNote,
  className,
  showPill = true,
  afterContent,
}: RecordingShareContentProps): ReactElement => {
  const content = (
    <>
      {recordingShare.noteHtml && renderNote?.(recordingShare.noteHtml)}
      {showPill && (
        <RecordingSharePill
          title={recordingShare.displayTitle}
          durationMs={recordingShare.durationMs}
          onOpen={recordingShare.openRecording}
        />
      )}
      {afterContent}
    </>
  );

  return className ? <div className={className}>{content}</div> : content;
};
