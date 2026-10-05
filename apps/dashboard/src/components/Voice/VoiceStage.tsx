import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Bug, Sparkles } from 'lucide-react';
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
import { DIAGNOSE_ENABLED } from './diagnoseLog';
import { useVoiceSession, voiceSession, type VoicePhase } from './voiceSession';

interface VoiceStageProps {
  /** The studio the spoken request was routed to, when it was one. */
  studioMode?: string | null;
}

const PHASE_LABEL: Record<VoicePhase, string> = {
  idle: 'Ready',
  listening: 'Listening…',
  transcribing: 'Transcribing…',
  thinking: 'Thinking…',
  speaking: 'Speaking…',
};

/** Voice mode for the sidebar and the /ai page: the orb and its status on top, the conversation as captions below. */
export function VoiceStage({ studioMode }: VoiceStageProps): ReactElement {
  const { phase, liveText, turns, diagnostics, playbackBlocked } = useVoiceSession();
  const [diagnosing, setDiagnosing] = useState(false);
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

  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [turns, diagnosing]);

  return (
    <section
      ref={stageRef}
      tabIndex={-1}
      aria-label='Voice mode'
      className='flex min-h-0 flex-1 flex-col items-center px-4 pb-3 pt-4 outline-none'
    >
      <VoiceOrbButton
        phase={phase}
        scope={stageRef}
        onHoldStart={voiceSession.startRecording}
        onHoldEnd={voiceSession.stopRecording}
      />
      <p
        role='status'
        className={cn(
          'mt-1 text-sm font-medium',
          phase === 'listening' ? 'text-primary' : 'text-foreground',
        )}
      >
        {PHASE_LABEL[phase]}
      </p>
      {studioMode && (
        <span className='mt-1 inline-flex items-center gap-1 rounded-full bg-claw-ai-fg/10 px-2.5 py-1 text-xs font-semibold text-claw-ai-fg'>
          <Sparkles className='h-3 w-3' aria-hidden />
          {studioMode} mode
        </span>
      )}
      <div className='flex h-8 items-center'>
        {playbackBlocked ? (
          <TapToHearButton onClick={voiceSession.resumePlayback} />
        ) : (
          <p className='text-xs text-muted-foreground'>Hold the orb or Space to talk</p>
        )}
      </div>
      <p className='line-clamp-3 min-h-[3.75rem] max-w-xs text-center text-sm text-foreground'>
        {liveText}
      </p>

      <div className='mt-2 flex min-h-0 w-full flex-1 flex-col'>
        {diagnosing ? (
          <DiagnosePanel events={diagnostics} />
        ) : (
          <div
            aria-label='Conversation'
            className='flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto'
          >
            {turns.map(turn => (
              <p
                key={turn.id}
                className={cn(
                  'max-w-[85%] rounded-2xl px-3 py-1.5 text-sm leading-snug',
                  turn.speaker === 'you'
                    ? 'self-end rounded-br-sm bg-primary text-primary-foreground'
                    : 'self-start rounded-bl-sm bg-secondary text-secondary-foreground',
                )}
              >
                {turn.text}
              </p>
            ))}
            <div ref={endRef} />
          </div>
        )}
      </div>

      <div className='flex items-center justify-center gap-1 pt-3'>
        <BackButton onExit={voiceSession.exit} />
        <MuteButton />
        <VoiceSettingsPopover />
        {DIAGNOSE_ENABLED && (
          <IconButton
            label={diagnosing ? 'Hide diagnostics' : 'Diagnose'}
            className={cn(diagnosing && 'bg-accent text-foreground')}
            onClick={() => setDiagnosing(on => !on)}
          >
            <Bug />
          </IconButton>
        )}
        <StopButton onStop={voiceSession.stop} className={cn(!stoppable && 'invisible')} />
      </div>
    </section>
  );
}
