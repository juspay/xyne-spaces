import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Bug, Captions, Sparkles } from 'lucide-react';
import { cn } from '../../utils/classNames';
import {
  BackButton,
  IconButton,
  MuteButton,
  StopButton,
  TapToHearButton,
  VoiceOrbButton,
  canStop,
} from './VoiceControls';
import { DiagnosePanel } from './DiagnosePanel';
import { VoiceSettingsPopover } from './VoiceSettingsPopover';
import { VOICE_DEBUG_ENABLED } from '../../services/VoiceInput/voiceDebug';
import { useVoiceSession, voiceSession, type VoicePhase } from './voiceSession';
import { transcriptOf, type TranscriptLine } from './voiceTranscript';
import type { Message } from '../Chat/XyneAISidebar/utils/XyneAITypes';

interface VoiceStageProps {
  studioMode?: string | null;
  /** The chat voice mode is in: its messages are the transcript, so earlier turns show too. */
  messages?: readonly Message[] | undefined;
  /** Shown as the chat voice mode is in. */
  chatTitle?: string | undefined;
}

const PHASE_LABEL: Record<VoicePhase, string> = {
  idle: 'Ready',
  listening: 'Listening…',
  transcribing: 'Transcribing…',
  understanding: 'Understanding…',
  asking: 'Asking Xyne AI…',
  speaking: 'Speaking…',
};

type Panel = 'transcript' | 'diagnose';

export function VoiceStage({ studioMode, messages, chatTitle }: VoiceStageProps): ReactElement {
  const { phase, liveText, turns, playbackBlocked } = useVoiceSession();
  // Without the chat (the AI screen), only what was said since voice mode opened.
  const lines = useMemo(
    (): TranscriptLine[] =>
      messages ? transcriptOf(messages) : turns.map(turn => ({ ...turn, live: false })),
    [messages, turns],
  );
  // The transcript is open from the start, so what is said and answered is always in view.
  const [panel, setPanel] = useState<Panel | null>('transcript');
  const toggle = (next: Panel): void => setPanel(open => (open === next ? null : next));
  const stageRef = useRef<HTMLElement>(null);
  const stoppable = canStop(phase);

  // Space talks while focus is in the stage, so it takes focus unless the user is typing elsewhere.
  useEffect(() => {
    const active = document.activeElement;
    const typing =
      active instanceof HTMLElement &&
      (active.isContentEditable || active.matches('input, textarea, select'));
    if (!typing) stageRef.current?.focus({ preventScroll: true });
  }, []);

  // Esc stops the turn while focus is in the stage. Listening on the stage itself leaves out
  // the settings popover, whose portal is outside it in the DOM, and Esc elsewhere on the page.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !stoppable) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') voiceSession.stop();
    };
    stage.addEventListener('keydown', onKeyDown);
    return (): void => stage.removeEventListener('keydown', onKeyDown);
  }, [stoppable]);

  // Follows the newest line, and a reply as it grows.
  const endRef = useRef<HTMLDivElement>(null);
  const newest = lines.at(-1);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [lines.length, newest?.text, panel]);

  return (
    <section
      ref={stageRef}
      tabIndex={-1}
      aria-label='Voice mode'
      className='flex min-h-0 flex-1 flex-col items-center px-4 pb-3 pt-4 outline-none'
    >
      {chatTitle && (
        <p className='w-full truncate text-center text-xs text-muted-foreground'>
          In: <span className='font-medium text-foreground'>{chatTitle}</span>
        </p>
      )}
      <div className='flex min-h-0 w-full flex-[3] flex-col items-center justify-center'>
        <VoiceOrbButton
          phase={phase}
          scope={stageRef}
          onHoldStart={voiceSession.startRecording}
          onHoldEnd={voiceSession.stopRecording}
        />
        <div className='flex h-7 items-center gap-2'>
          <p
            role='status'
            className={cn(
              'text-sm font-medium',
              phase === 'listening' ? 'text-primary' : 'text-foreground',
            )}
          >
            {PHASE_LABEL[phase]}
          </p>
          {studioMode && (
            <span className='inline-flex items-center gap-1 rounded-full bg-claw-ai-fg/10 px-2.5 py-1 text-xs font-semibold text-claw-ai-fg'>
              <Sparkles className='h-3 w-3' aria-hidden />
              {studioMode} mode
            </span>
          )}
        </div>
        <p className='line-clamp-2 h-10 max-w-xs text-center text-sm text-foreground'>{liveText}</p>
        <div className='flex h-8 items-center'>
          {playbackBlocked ? (
            <TapToHearButton onClick={voiceSession.resumePlayback} />
          ) : (
            <p className='text-xs text-muted-foreground'>Hold the orb or Space to talk</p>
          )}
        </div>
      </div>

      {panel === 'diagnose' && (
        <div className='mt-2 flex min-h-0 w-full flex-[2] flex-col'>
          <DiagnosePanel phase={phase} />
        </div>
      )}
      {panel === 'transcript' && (
        <div
          aria-label='Conversation'
          // Scrolls without a bar, and lines leaving at the top fade instead of being cut.
          className='no-scrollbar mt-2 flex min-h-0 w-full flex-[2] flex-col gap-2 overflow-y-auto pt-4 [mask-image:linear-gradient(to_bottom,transparent,black_1.5rem)]'
        >
          {lines.length === 0 && (
            <p className='m-auto text-center text-xs text-muted-foreground'>
              What you say and Xyne&apos;s replies show here.
            </p>
          )}
          {lines.map(line => (
            <p
              key={line.id}
              className={cn(
                // Never squeezed to fit: the list scrolls, long replies with it.
                'max-w-[85%] shrink-0 rounded-2xl px-3 py-1.5 text-sm leading-snug',
                line.speaker === 'you'
                  ? 'self-end rounded-br-sm bg-primary text-primary-foreground'
                  : 'self-start rounded-bl-sm bg-secondary text-secondary-foreground',
              )}
            >
              {line.text ||
                (line.live && (
                  <span className='animate-pulse' aria-label='Xyne is replying'>
                    …
                  </span>
                ))}
            </p>
          ))}
          <div ref={endRef} />
        </div>
      )}

      <div className='flex items-center justify-center gap-1 pt-3'>
        <BackButton onExit={voiceSession.exit} />
        <MuteButton />
        <VoiceSettingsPopover />
        <IconButton
          label={panel === 'transcript' ? 'Hide transcript' : 'Show transcript'}
          data-track-category='XyneAI'
          data-track-name='VOICE_MODE_TRANSCRIPT'
          className={cn(panel === 'transcript' && 'bg-accent text-foreground')}
          onClick={() => toggle('transcript')}
        >
          <Captions />
        </IconButton>
        {VOICE_DEBUG_ENABLED && (
          <IconButton
            label={panel === 'diagnose' ? 'Hide debugger' : 'Voice debugger'}
            data-track-category='XyneAI'
            data-track-name='VOICE_MODE_DEBUGGER'
            className={cn(panel === 'diagnose' && 'bg-accent text-foreground')}
            onClick={() => toggle('diagnose')}
          >
            <Bug />
          </IconButton>
        )}
        <StopButton onStop={voiceSession.stop} className={cn(!stoppable && 'invisible')} />
      </div>
    </section>
  );
}
