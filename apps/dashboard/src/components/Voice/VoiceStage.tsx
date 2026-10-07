import { useEffect, useRef, useState, type ReactElement } from 'react';
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
import { AssistantCard } from '../Assistant/AssistantCard';
import type { CurrentCard } from '../Assistant/turns';
import { DiagnosePanel } from './DiagnosePanel';
import { VoiceSettingsPopover } from './VoiceSettingsPopover';
import { DIAGNOSE_ENABLED, useDiagnostics } from './diagnoseLog';
import { useVoiceSession, voiceSession, type VoicePhase } from './voiceSession';

interface VoiceStageProps {
  /** The studio the spoken request was routed to, when it was one. */
  studioMode?: string | null;
  /** What the assistant asks the user to tap, and what a tap does. */
  card?: CurrentCard | null;
  onPick?: (optionId: string) => boolean;
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

/**
 * Voice mode for the sidebar and the /ai page: the orb centered with its status and current line;
 * once the transcript (open at first, so what was said and answered is always in view) or
 * diagnostics have something to show, the orb moves up and they take the room below, with the card
 * to tap under them.
 */
export function VoiceStage({ studioMode, card, onPick }: VoiceStageProps): ReactElement {
  const { phase, liveText, turns, playbackBlocked } = useVoiceSession();
  const diagnostics = useDiagnostics();
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

  // The panel takes the room once it has something to show; until then the orb stays centered.
  const docked = panel === 'diagnose' || (panel === 'transcript' && turns.length > 0);

  // The transcript follows the newest turn, unless the user has scrolled up to read. It is kept at
  // the bottom whenever its box (docking, a card below it) or its turns change size.
  const transcriptRef = useRef<HTMLDivElement>(null);
  const turnsRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  useEffect(() => {
    const transcript = transcriptRef.current;
    const content = turnsRef.current;
    if (!transcript || !content) return undefined;
    const observer = new ResizeObserver(() => {
      if (following.current) transcript.scrollTop = transcript.scrollHeight;
    });
    observer.observe(transcript);
    observer.observe(content);
    return (): void => observer.disconnect();
  }, [panel]);

  return (
    <section
      ref={stageRef}
      tabIndex={-1}
      aria-label='Voice mode'
      className='flex min-h-0 flex-1 flex-col items-center gap-3 px-4 py-3 outline-none'
    >
      {/* Its share of the free space eases from all to none as the panel docks, so the orb glides
          up instead of jumping. */}
      <div
        className={cn(
          'flex w-full shrink-0 basis-auto flex-col items-center justify-center',
          'transition-[flex-grow] duration-300 ease-out motion-reduce:transition-none',
          docked ? 'grow-0' : 'grow',
        )}
      >
        <VoiceOrbButton
          phase={phase}
          scope={stageRef}
          compact={docked}
          onHoldStart={voiceSession.startRecording}
          onHoldEnd={voiceSession.stopRecording}
        />
        <div className='-mt-2 flex h-7 items-center gap-2'>
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
        {/* Only takes room while there is something live to show, so the status and hint stay together. */}
        {liveText && (
          <p className='line-clamp-2 max-w-xs text-center text-sm text-foreground'>{liveText}</p>
        )}
        <div className='flex h-6 items-center'>
          {playbackBlocked ? (
            <TapToHearButton onClick={voiceSession.resumePlayback} />
          ) : (
            <p className='text-xs text-muted-foreground'>Hold the orb or Space to talk</p>
          )}
        </div>
      </div>

      {panel === 'diagnose' && (
        <div className='flex min-h-0 w-full flex-1 basis-0 flex-col'>
          <DiagnosePanel events={diagnostics} />
        </div>
      )}
      {panel === 'transcript' && (
        <div
          ref={transcriptRef}
          aria-label='Conversation'
          onScroll={({ currentTarget: { scrollHeight, scrollTop, clientHeight } }) => {
            following.current = scrollHeight - scrollTop - clientHeight < 24;
          }}
          className={cn(
            'min-h-0 w-full basis-0 overflow-y-auto overscroll-contain',
            'transition-[flex-grow] duration-300 ease-out motion-reduce:transition-none',
            docked ? 'grow' : 'grow-0',
          )}
        >
          <div ref={turnsRef} className='flex flex-col gap-2'>
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
          </div>
        </div>
      )}

      {/* Under what was said, so what is to be confirmed is read in its place. */}
      {card && onPick && (
        <div className='w-full max-w-xs shrink-0'>
          <AssistantCard key={card.messageId} card={card} onPick={onPick} />
        </div>
      )}

      <div className='flex shrink-0 items-start justify-center'>
        <BackButton onExit={voiceSession.exit} />
        <MuteButton />
        <VoiceSettingsPopover />
        <IconButton
          label={panel === 'transcript' ? 'Hide transcript' : 'Show transcript'}
          caption='Transcript'
          className={cn(panel === 'transcript' && 'bg-accent text-foreground')}
          onClick={() => toggle('transcript')}
        >
          <Captions />
        </IconButton>
        {DIAGNOSE_ENABLED && (
          <IconButton
            label={panel === 'diagnose' ? 'Hide diagnostics' : 'Diagnose'}
            caption='Diagnose'
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
