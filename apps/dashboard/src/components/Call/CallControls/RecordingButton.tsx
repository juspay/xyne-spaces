import { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, Monitor, CircleDot, CircleStop } from 'lucide-react';
import { RecordingType } from '@xyne/shared';
import { cn } from '../../../utils/classNames';

export interface RecordingButtonProps {
  isRecording: boolean;
  /** Only the participant who started the recording may stop it. */
  canStopRecording?: boolean;
  onStartRecording?: ((type: RecordingType) => void | Promise<void>) | undefined;
  onStopRecording?: (() => void | Promise<void>) | undefined;
  hasCustomSizing: boolean;
  iconSize: number;
  buttonPadding: number;
  buttonClasses: string;
  midnightControlClass: string;
  midnightPopoverClass: string;
  callId: string;
}

export function RecordingButton({
  isRecording,
  canStopRecording = true,
  onStartRecording,
  onStopRecording,
  hasCustomSizing,
  iconSize,
  buttonPadding,
  buttonClasses,
  midnightControlClass,
  midnightPopoverClass,
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
      <button
        onClick={handleButtonClick}
        disabled={stopDisabled}
        className={cn(
          buttonClasses,
          isRecording
            ? 'bg-red-600 text-white shadow-red-900/40 animate-pulse [animation-duration:3s]'
            : showPicker
              ? 'bg-blue-600 hover:bg-blue-700 text-white'
              : midnightControlClass,
          isRecording && !stopDisabled && 'hover:bg-red-700',
          stopDisabled && 'cursor-default opacity-90',
        )}
        style={hasCustomSizing ? { padding: `${buttonPadding}px` } : undefined}
        title={
          isRecording
            ? stopDisabled
              ? 'Recording in progress — only the person who started it can stop it'
              : 'Stop recording'
            : 'Start AI recording'
        }
        data-track-event='BUTTON_CLICK'
        data-track-category='CALLS'
        data-track-name='TOGGLE_RECORDING'
        data-track-metadata={JSON.stringify({ callId, isRecording })}
      >
        {isRecording ? (
          <CircleStop
            className={hasCustomSizing ? '' : 'w-5 h-5 sm:w-6 sm:h-6'}
            style={
              hasCustomSizing ? { width: `${iconSize}px`, height: `${iconSize}px` } : undefined
            }
          />
        ) : (
          <CircleDot
            className={hasCustomSizing ? '' : 'w-5 h-5 sm:w-6 sm:h-6'}
            style={
              hasCustomSizing ? { width: `${iconSize}px`, height: `${iconSize}px` } : undefined
            }
          />
        )}
      </button>

      {showPicker && !isRecording && (
        <div
          className={cn(
            'absolute bottom-full mb-3 left-1/2 -translate-x-1/2 rounded-xl shadow-2xl overflow-hidden min-w-max',
            midnightPopoverClass,
          )}
        >
          <div className='px-4 pt-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-500'>
            Start AI recording
          </div>
          <button
            onClick={() => handlePick(RecordingType.AUDIO_ONLY)}
            className='flex items-center gap-3 w-full px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-600 transition-colors text-left'
            data-track-category='CALLS'
            data-track-name='start-recording-audio-only'
          >
            <Mic className='w-4 h-4 text-blue-400 flex-shrink-0' />
            <div>
              <div className='font-medium'>Voice only</div>
              <div className='text-xs text-gray-400'>Record participant audio and transcript</div>
            </div>
          </button>
          <div className='h-px bg-gray-600 mx-3' />
          <button
            onClick={() => handlePick(RecordingType.AUDIO_SCREEN)}
            className='flex items-center gap-3 w-full px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-600 transition-colors text-left'
            data-track-category='CALLS'
            data-track-name='start-recording-audio-screen'
          >
            <Monitor className='w-4 h-4 text-purple-400 flex-shrink-0' />
            <div>
              <div className='font-medium'>Screen + voice</div>
              <div className='text-xs text-gray-400'>
                Record screen share, audio, and transcript
              </div>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}
