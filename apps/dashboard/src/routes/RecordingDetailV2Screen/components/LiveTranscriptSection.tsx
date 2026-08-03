/**
 * Live transcript for the recording detail screen — the page-variant host for
 * LiveTranscriptList, which the note-taker overlay renders in its panel variant.
 *
 * The transcript only exists in the tab running the LiveKit session, so a recording
 * opened anywhere else renders the "captured elsewhere" state instead.
 */

import { type ReactElement } from 'react';
import { LiveTranscriptList } from '../../../components/Notetaker/LiveTranscriptList';
import { useRecordingStore } from '../../../hooks/useRecordingStore';

const TRACK_CATEGORY = 'RecordingDetailV2';

interface LiveTranscriptSectionProps {
  /** External id of the recording being viewed, to confirm this tab owns its session. */
  recordingExternalId: string;
}

export const LiveTranscriptSection = ({
  recordingExternalId,
}: LiveTranscriptSectionProps): ReactElement => {
  const activeExternalId = useRecordingStore(context => context.externalId);
  const status = useRecordingStore(context => context.status);
  const transcripts = useRecordingStore(context => context.transcripts);
  const markedMoments = useRecordingStore(context => context.markedMoments);

  const ownsSession =
    activeExternalId === recordingExternalId && (status === 'recording' || status === 'paused');

  if (!ownsSession) {
    return <CapturedElsewhereState />;
  }

  return (
    <section className='mb-8'>
      <LiveTranscriptList
        variant='page'
        transcripts={transcripts}
        markedMoments={markedMoments}
        isPaused={status === 'paused'}
        trackCategory={TRACK_CATEGORY}
      />
    </section>
  );
};

/**
 * The live transcript streams over this tab's own LiveKit connection, so a recording
 * started in another tab, browser or device has nothing to render here.
 */
const CapturedElsewhereState = (): ReactElement => (
  <section className='mb-8 flex min-h-[320px] flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-border px-6 text-center'>
    <svg
      viewBox='0 0 64 64'
      className='size-16 text-muted-foreground/45'
      fill='none'
      role='img'
      aria-label='Recording captured in another session'
    >
      <rect
        x='6'
        y='14'
        width='34'
        height='26'
        rx='5'
        stroke='currentColor'
        strokeWidth='2.5'
        opacity='0.45'
      />
      <rect x='24' y='24' width='34' height='26' rx='5' stroke='currentColor' strokeWidth='2.5' />
      <circle cx='41' cy='37' r='4.5' className='text-destructive' fill='currentColor' />
      <path
        d='M14 46h10'
        stroke='currentColor'
        strokeWidth='2.5'
        strokeLinecap='round'
        opacity='0.45'
      />
    </svg>
    <div className='space-y-1'>
      <p className='text-sm font-medium text-foreground'>
        This recording is being captured in another session
      </p>
      <p className='mx-auto max-w-sm text-sm text-muted-foreground'>
        The live transcript streams to the tab that started it. Switch to that tab to follow along —
        the full transcript and summary land here once the recording ends.
      </p>
    </div>
  </section>
);

export default LiveTranscriptSection;
