/**
 * RecordingControlBar - Sticky bottom bar with record/stop/pause button
 * Mirrors the native RecordingControls component: waveform bars + control buttons
 */

import { ReactElement, useEffect, useState, useRef } from 'react';
import { Loader2, Pause, Play } from 'lucide-react';
import { formatElapsedTime } from '../../../utils/recordingUtils';

/**
 * Returns true when the dashboard is running inside a mobile browser or
 * Lotus WebView. In that context the MobileNavbar pill (~72 px) sits fixed
 * at the bottom of the viewport, so the RecordingControlBar needs extra
 * padding-bottom to keep the red button visible above the pill.
 */
function useMobileWebPadding(): boolean {
  const [isMobileWeb, setIsMobileWeb] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent || '';
    // React-Native WebView or viewport narrower than a typical tablet.
    const isNativeWebView =
      /ReactNative/i.test(ua) ||
      /lotusWebEngine/i.test(ua) ||
      (window.innerWidth < 700 && !/Electron/i.test(ua));
    setIsMobileWeb(isNativeWebView);
  }, []);

  return isMobileWeb;
}

interface RecordingControlBarProps {
  isRecording: boolean;
  isPaused: boolean;
  isStarting: boolean;
  startTime: number | null;
  onStart: () => void;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
}

export function RecordingControlBar({
  isRecording,
  isPaused,
  isStarting,
  startTime,
  onStart,
  onStop,
  onPause,
  onResume,
}: RecordingControlBarProps): ReactElement {
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isRecording && !isPaused && startTime) {
      setElapsed(Date.now() - startTime);
      intervalRef.current = setInterval(() => {
        setElapsed(Date.now() - startTime);
      }, 1000);
    }

    return (): void => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isRecording, isPaused, startTime]);

  const isMobileWeb = useMobileWebPadding();
  // MOBILE_NAV_H ≈ height of the MobileNavbar pill (44 px items + py-2 + bottom-2)
  const MOBILE_NAV_H = 72;

  return (
    <div
      className='sticky bottom-0 z-10 border-t border-border dark:border-gray-700 dark:bg-gray-900 px-6 pt-4'
      style={{ paddingBottom: isMobileWeb ? `${MOBILE_NAV_H + 16}px` : '1rem' }}
    >
      <div className='max-w-4xl mx-auto flex items-center justify-center gap-4'>
        {/* Waveform bars (left side, visible when recording) */}
        {isRecording && (
          <div className='flex items-center gap-[3px] h-8'>
            {[0, 1, 2].map(i => (
              <div
                key={i}
                className='w-[3px] rounded-full bg-emerald-500'
                style={{
                  animation: `controlBarWave 0.5s ease-in-out ${i * 0.1}s infinite alternate`,
                  height: '40%',
                }}
              />
            ))}
          </div>
        )}

        {/* Elapsed time */}
        {isRecording && (
          <span className='text-sm font-mono text-muted-foreground dark:text-muted-foreground min-w-[52px] text-center'>
            {formatElapsedTime(elapsed)}
          </span>
        )}

        {/* Pause/Resume and Stop buttons (visible when recording) */}
        {isRecording ? (
          <>
            <button
              onClick={isPaused ? onResume : onPause}
              disabled={isStarting}
              className='flex items-center justify-center w-10 h-10 rounded-full bg-muted dark:bg-gray-700 hover:bg-border dark:hover:bg-gray-600 transition-colors disabled:opacity-50'
              title={isPaused ? 'Resume recording' : 'Pause recording'}
              data-track-category='RecordingControlBar'
              data-track-name={isPaused ? 'resume_recording' : 'pause_recording'}
            >
              {isPaused ? (
                <Play className='w-5 h-5 text-foreground dark:text-gray-200' />
              ) : (
                <Pause className='w-5 h-5 text-foreground dark:text-gray-200' />
              )}
            </button>

            <button
              onClick={onStop}
              className='flex items-center justify-center w-12 h-12 rounded-xl bg-border dark:bg-gray-700 hover:bg-muted-foreground/50 dark:hover:bg-gray-600 transition-colors'
              title='Stop recording'
              data-track-category='RecordingControlBar'
              data-track-name='stop_recording'
            >
              {/* Square stop icon */}
              <div className='w-5 h-5 rounded-sm bg-gray-600 dark:bg-muted-foreground/50' />
            </button>
          </>
        ) : (
          <button
            onClick={onStart}
            disabled={isStarting}
            className='flex items-center justify-center w-14 h-14 rounded-full bg-red-500 hover:bg-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg'
            title='Start recording'
            data-track-category='RecordingControlBar'
            data-track-name='start_recording'
          >
            {isStarting ? (
              <Loader2 className='w-6 h-6 text-white animate-spin' />
            ) : (
              /* Circle record icon */
              <div className='w-6 h-6 rounded-full bg-background' />
            )}
          </button>
        )}

        {/* Waveform bars (right side, visible when recording) */}
        {isRecording && (
          <div className='flex items-center gap-[3px] h-8'>
            {[0, 1, 2].map(i => (
              <div
                key={i}
                className='w-[3px] rounded-full bg-emerald-500'
                style={{
                  animation: `controlBarWave 0.6s ease-in-out ${i * 0.15}s infinite alternate`,
                  height: '40%',
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Waveform keyframes */}
      <style>{`
        @keyframes controlBarWave {
          from { height: 25%; }
          to { height: 100%; }
        }
      `}</style>
    </div>
  );
}
