import { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, Monitor, CircleDot, CircleStop } from 'lucide-react';
import { RecordingType } from '@xyne/shared';
import { cn } from '../../../utils/classNames';
import { ControlButton, type ControlSizing } from './ControlButton';

/** Text label for the full-view button; the red fill shows it's live. */
function RecLabel(): React.ReactElement {
  return <span className='text-[11px] font-extrabold leading-none tracking-tight'>REC</span>;
}

export interface RecordingButtonProps {
  isRecording: boolean;
  /** Only the participant who started the recording may stop it. */
  canStopRecording?: boolean;
  onStartRecording?: ((type: RecordingType) => void | Promise<void>) | undefined;
  onStopRecording?: (() => void | Promise<void>) | undefined;
  sizing: ControlSizing;
  callId: string;
}

export function RecordingButton({
  isRecording,
  canStopRecording = true,
  onStartRecording,
  onStopRecording,
  sizing,
  callId,
}: RecordingButtonProps): React.ReactElement {
  const [showPicker, setShowPicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent): void => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return (): void => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Only the starter can stop; for everyone else the button is a non-interactive
  // "recording in progress" indicator (no stop/rename popup).
  const stopDisabled = isRecording && !canStopRecording;

  const handleButtonClick = useCallback(() => {
    if (isRecording) {
      if (!canStopRecording) return;
      void onStopRecording?.();
    } else {
      setShowPicker(prev => !prev);
    }
  }, [isRecording, canStopRecording, onStopRecording]);

  const handlePick = useCallback(
    (type: RecordingType) => {
      setShowPicker(false);
      void onStartRecording?.(type);
    },
    [onStartRecording],
  );

  return (
    <div className='relative' ref={pickerRef}>
      <ControlButton
        sizing={sizing}
        // Full view shows "REC" in the round button; the mini window keeps the icon.
        icon={sizing.isFullView ? RecLabel : isRecording ? CircleStop : CircleDot}
        label={
          isRecording
            ? stopDisabled
              ? 'Recording in progress — only the person who started it can stop it'
              : 'Stop recording'
            : 'Start recording'
        }
        tone={isRecording ? 'off' : showPicker ? 'active' : 'neutral'}
        className={cn(
          !sizing.isFullView && isRecording && 'animate-pulse [animation-duration:3s]',
          stopDisabled && 'cursor-default opacity-90 hover:bg-[#dc362e]',
        )}
        onClick={handleButtonClick}
        disabled={stopDisabled}
        aria-expanded={isRecording ? undefined : showPicker}
        data-track-event='BUTTON_CLICK'
        data-track-category='CALLS'
        data-track-name='TOGGLE_RECORDING'
        data-track-metadata={JSON.stringify({
          callId,
          isRecording,
          // One button serves both actions: when not recording this click only
          // opens the mode picker, so the mode lands on the picker buttons below.
          intent: isRecording ? 'stop' : 'open_mode_picker',
        })}
      />

      {showPicker && !isRecording && (
        <div
          className={cn(
            'absolute bottom-full z-50 mb-3 left-1/2 -translate-x-1/2 rounded-xl overflow-hidden min-w-max py-1',
            'bg-[#1e1f20] ring-1 ring-white/10 text-[#e3e3e3] shadow-2xl',
          )}
        >
          <div className='px-4 pt-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-[#9aa0a6]'>
            Start recording
          </div>
          <button
            onClick={() => handlePick(RecordingType.AUDIO_ONLY)}
            className='flex items-center gap-3 w-full px-4 py-2.5 text-sm text-[#e3e3e3] hover:bg-white/10 transition-colors text-left'
            data-track-category='CALLS'
            data-track-name='start-recording-audio-only'
            data-track-metadata={JSON.stringify({
              callId,
              recordingType: RecordingType.AUDIO_ONLY,
            })}
          >
            <Mic className='w-4 h-4 text-blue-400 flex-shrink-0' />
            <div>
              <div className='font-medium'>Voice only</div>
              <div className='text-xs text-[#9aa0a6]'>Record participant audio and transcript</div>
            </div>
          </button>
          <div className='h-px bg-white/10 mx-3' />
          <button
            onClick={() => handlePick(RecordingType.AUDIO_SCREEN)}
            className='flex items-center gap-3 w-full px-4 py-2.5 text-sm text-[#e3e3e3] hover:bg-white/10 transition-colors text-left'
            data-track-category='CALLS'
            data-track-name='start-recording-audio-screen'
            data-track-metadata={JSON.stringify({
              callId,
              recordingType: RecordingType.AUDIO_SCREEN,
            })}
          >
            <Monitor className='w-4 h-4 text-purple-400 flex-shrink-0' />
            <div>
              <div className='font-medium'>Screen + voice</div>
              <div className='text-xs text-[#9aa0a6]'>
                Record screen share, audio, and transcript
              </div>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}
