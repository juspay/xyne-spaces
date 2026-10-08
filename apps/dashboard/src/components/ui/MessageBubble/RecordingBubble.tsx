import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, PauseBig, PlayBig, StopBig } from '@xyne/icons';
import { Button } from '../Button/Button';
import { Tooltip } from '../Tooltip';
import { useAuth } from '../../../hooks/useAuth';
import { useCallDuration } from '../../../hooks/useCalls';
import { sendRecordingEvent, useRecordingStore } from '../../../hooks/useRecordingStore';
import { useStopRecording } from '../../../hooks/useStopRecording';
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

  const localStatus = useRecordingStore(ctx => (ctx.externalId === callId ? ctx.status : null));
  const isPaused = localStatus === 'paused';
  const canControl = !isEnded && (localStatus === 'recording' || isPaused);
  const stopRecording = useStopRecording();

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
    <div
      className='flex w-full max-w-lg items-center gap-2.5 rounded-xl border border-border bg-card py-1 pl-3 pr-1'
      data-testid='recording-active-card'
    >
      <span className='relative flex size-2 shrink-0' aria-hidden='true'>
        {!isPaused && (
          <span className='absolute inline-flex h-full w-full animate-ping rounded-full bg-status-failure opacity-75' />
        )}
        <span
          className={`relative inline-flex size-2 rounded-full ${isPaused ? 'bg-muted-foreground' : 'bg-status-failure'}`}
        />
      </span>
      <span className='min-w-0 flex-1 truncate text-sm font-medium text-foreground'>
        Recording notes
        <span className='ml-1.5 font-normal text-xs tabular-nums text-muted-foreground'>
          {isPaused ? 'Paused' : duration ? `${duration} elapsed` : 'Just started'}
        </span>
      </span>
      {canControl && (
        <div className='flex shrink-0 items-center gap-1'>
          <Tooltip content={isPaused ? 'Resume recording' : 'Pause recording'} side='top'>
            <Button
              type='button'
              variant='ghost'
              size='icon'
              className='size-6 rounded-full text-muted-foreground hover:text-foreground'
              onClick={() =>
                sendRecordingEvent({ type: isPaused ? 'resumeRecording' : 'pauseRecording' })
              }
              aria-label={isPaused ? 'Resume recording' : 'Pause recording'}
              data-track-category='RECORDING'
              data-track-name={isPaused ? 'RESUME_FROM_THREAD' : 'PAUSE_FROM_THREAD'}
            >
              {isPaused ? (
                <PlayBig size={14} variant='Solid' />
              ) : (
                <PauseBig size={14} strokeWidth={4} variant='Solid' />
              )}
            </Button>
          </Tooltip>
          <Tooltip content='End recording' side='top'>
            <Button
              type='button'
              variant='destructive'
              size='icon'
              className='size-6 rounded-full'
              onClick={stopRecording}
              aria-label='End recording'
              data-track-category='RECORDING'
              data-track-name='END_FROM_THREAD'
            >
              <StopBig size={14} variant='Solid' />
            </Button>
          </Tooltip>
        </div>
      )}
      {canView && (
        <Button
          type='button'
          variant='default'
          size='sm'
          onClick={goToRecording}
          className='h-7 gap-0.5 rounded-full pl-3 pr-2 text-xs font-semibold bg-card hover:bg-border text-foreground'
          data-track-category='RECORDING'
          data-track-name='OPEN_LIVE_RECORDING_FROM_THREAD'
        >
          View
          <ChevronRight size={12} strokeWidth={2.2} />
        </Button>
      )}
    </div>
  );
};
