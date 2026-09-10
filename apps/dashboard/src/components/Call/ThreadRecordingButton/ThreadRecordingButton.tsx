import { MicOn } from '@xyne/icons';
import { Button } from '../../ui/Button';
import Tooltip from '../../ui/Tooltip';

interface ThreadRecordingButtonProps {
  onStartRecording: () => void;
  hasActiveRecording?: boolean;
  testId?: string;
  trackCategory?: string;
  trackName?: string;
  trackMetadata?: Record<string, unknown>;
}

/**
 * "Take notes" button for thread/conversation headers — starts a headless
 * (note-taker) recording anchored to this thread. Matches ThreadCallButton's
 * sizing/placement (28px ghost, single icon) so the two sit naturally side by
 * side in the conversation-header action row.
 */
export const ThreadRecordingButton = ({
  onStartRecording,
  hasActiveRecording = false,
  testId = 'thread-start-recording-button',
  trackCategory,
  trackName,
  trackMetadata,
}: ThreadRecordingButtonProps) => {
  return (
    <Tooltip content={hasActiveRecording ? 'Recording already in progress' : 'Take notes'}>
      <Button
        variant='ghost'
        size='sm'
        onClick={onStartRecording}
        disabled={hasActiveRecording}
        className='h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground'
        data-testid={testId}
        {...(trackCategory && { 'data-track-category': trackCategory })}
        {...(trackName && { 'data-track-name': trackName })}
        {...(trackMetadata && {
          'data-track-metadata': JSON.stringify(trackMetadata),
        })}
      >
        <MicOn size={16} />
      </Button>
    </Tooltip>
  );
};
