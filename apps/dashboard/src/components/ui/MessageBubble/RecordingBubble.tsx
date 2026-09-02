import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AudioLines } from 'lucide-react';
import { useAuth } from '../../../hooks/useAuth';
import { useCallDuration } from '../../../hooks/useCalls';
import { RenderMessageWithHTML } from '../../Chat/RenderMessageWithHTML/RenderMessageWithHTML';
import { RecordingSharePill } from './RecordingSharePill';
import { MessageMetadata } from './MessageBubble.utils';

interface RecordingBubbleProps {
  message: {
    messageId: string;
    content: string;
    createdAt: number | Date;
    metadata: MessageMetadata | null;
  };
  callId: string;
}

/**
 * RecordingBubble — the single anchor message posted when a headless
 * ("take notes") recording is started from inside a thread.
 *
 * Mirrors the CALL message mechanic (one message that live-anchors a
 * pill/overlay while the thing is in progress, then settles into a normal
 * card once it ends — see CallBubble/CallMessageOverlay) but with its own,
 * distinct visuals: a recording has no join/participants concept, so it's
 * a single always-clickable card rather than a header + overlay pair.
 *
 * Same trick CallBubble uses to avoid a per-message live query: everything
 * needed to render is already on the message itself. The anchor message is
 * only ever created once the recording is actually live (see
 * noteTakerCallRepository.createThreadAnchorMessage), so its mere existence
 * means "active"; `metadata.operation === 'recording_ended'` (stamped by
 * updateThreadMessageOnEnd) flips it to "ended"; and the AI-generated title
 * is patched directly onto message.content once ready (updateThreadMessageTitle)
 * instead of living only on the Call row. No Zero query on `calls` needed.
 */
export const RecordingBubble: React.FC<RecordingBubbleProps> = ({ message, callId }) => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const metadata = message.metadata;
  const isEnded = metadata?.['operation'] === 'recording_ended';
  const isActive = !isEnded;
  const startedAt = message.createdAt ? Number(message.createdAt) : undefined;
  const duration = useCallDuration(startedAt, isActive);

  const canView = isEnded || (!!user?.id && metadata?.createdBy === user.id);

  const goToRecording = (): void => {
    if (!canView) return;
    void navigate(`/recordings/${callId}`);
  };

  if (isEnded) {
    const durationMs = typeof metadata?.['durationMs'] === 'number' ? metadata['durationMs'] : null;
    const title = message.content || 'Recording notes';
    const messageContent =
      typeof metadata?.['messageContent'] === 'string' ? metadata['messageContent'] : null;

    // Reuses the exact same pill used when a recording is manually shared to
    // a channel (RecordingShareContent/RecordingSharePill) — keeps "a
    // recording card in a message" looking identical everywhere instead of
    // maintaining a second, slightly-different design here.
    return (
      <div className='flex w-full max-w-lg flex-col gap-1'>
        {messageContent && (
          <div className='jp-message-html whitespace-pre-wrap break-words text-sm text-foreground'>
            <RenderMessageWithHTML message={messageContent} />
          </div>
        )}
        <RecordingSharePill
          title={title}
          durationMs={durationMs}
          onOpen={canView ? goToRecording : undefined}
        />
      </div>
    );
  }

  return (
    <button
      type='button'
      onClick={goToRecording}
      disabled={!canView}
      className='group flex w-full max-w-lg items-center gap-2.5 rounded-lg border border-border bg-card enabled:hover:bg-muted/50 transition-colors px-3 py-1.5 text-left disabled:cursor-default'
      data-testid='recording-active-card'
      data-track-category='RECORDING'
      data-track-name='OPEN_LIVE_RECORDING_FROM_THREAD'
    >
      <span className='flex size-5 shrink-0 items-center justify-center rounded-md bg-muted'>
        <AudioLines size={12} strokeWidth={2.5} className='text-muted-foreground' />
      </span>
      <span className='min-w-0 flex-1 truncate text-sm font-medium text-foreground'>
        Recording notes
        <span className='ml-1.5 font-normal text-xs text-muted-foreground'>
          {duration ? `${duration} elapsed` : 'Just started'}
        </span>
      </span>
      <span className='relative flex size-2 shrink-0' aria-hidden='true'>
        <span className='absolute inline-flex h-full w-full animate-ping rounded-full bg-status-failure opacity-75' />
        <span className='relative inline-flex size-2 rounded-full bg-status-failure' />
      </span>
      {canView && (
        <span className='text-xs font-medium text-foreground shrink-0 rounded-full border border-border px-2 py-0.5'>
          View
        </span>
      )}
    </button>
  );
};
