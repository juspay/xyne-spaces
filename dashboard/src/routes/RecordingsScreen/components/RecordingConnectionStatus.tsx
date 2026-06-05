/**
 * RecordingConnectionStatus — UI components for recording connection state.
 *
 * Two co-located pieces driven by useRecordingConnectionState:
 *
 *  RecordingReconnectingOverlay    — full-screen overlay while room is reconnecting
 *  RecordingConnectionWarningModal — modal shown when network quality is Poor / Lost
 */

import type { ReactElement } from 'react';
import { ConnectionQuality } from 'livekit-client';
import { WifiOff } from 'lucide-react';

// ─── Reconnecting overlay ──────────────────────────────────────────────────────

/**
 * Shown as an absolute overlay inside the ActiveRecordingView container while
 * the LiveKit room is in ConnectionState.Reconnecting.
 * Mirrors the CallStateTransition reconnecting state visual.
 */
export function RecordingReconnectingOverlay(): ReactElement {
  return (
    <div
      role='status'
      aria-live='polite'
      className='absolute inset-0 z-20 flex flex-col items-center justify-center bg-background/90 dark:bg-gray-900/90 backdrop-blur-sm animate-in fade-in duration-200'
    >
      <div className='text-center px-4'>
        <div className='animate-spin rounded-full h-12 w-12 border-b-2 border-t-2 border-yellow-500 mx-auto mb-4' />
        <p className='font-semibold text-foreground dark:text-gray-100 mb-1'>Reconnecting...</p>
        <p className='text-sm text-yellow-500 dark:text-yellow-400'>
          Connection lost — your recording may be interrupted
        </p>
      </div>
    </div>
  );
}

// ─── Connection warning modal ──────────────────────────────────────────────────

interface RecordingConnectionWarningModalProps {
  networkQuality: ConnectionQuality | null;
  onDismiss: () => void;
}

/**
 * Fixed modal (z-[70]) shown when network quality degrades to Poor or Lost
 * while a recording is active.  The caller controls visibility — only render
 * this component when it should be visible.
 */
export function RecordingConnectionWarningModal({
  networkQuality,
  onDismiss,
}: RecordingConnectionWarningModalProps): ReactElement {
  const isLost = networkQuality === ConnectionQuality.Lost;

  return (
    <div
      role='dialog'
      aria-modal='true'
      aria-labelledby='recording-conn-warning-title'
      className='fixed inset-0 z-[70] flex items-center justify-center'
    >
      {/* Backdrop */}
      <div className='absolute inset-0 bg-black/50 animate-in fade-in duration-200' />

      {/* Panel */}
      <div className='relative bg-background dark:bg-gray-800 rounded-xl shadow-2xl border border-border dark:border-gray-700 w-full max-w-sm mx-4 p-6 animate-in zoom-in-95 fade-in duration-200'>
        <div className='flex items-start gap-4'>
          <div className='flex-shrink-0 w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center'>
            <WifiOff className='w-5 h-5 text-amber-600 dark:text-amber-400' />
          </div>
          <div className='flex-1'>
            <h2
              id='recording-conn-warning-title'
              className='text-base font-semibold text-foreground dark:text-gray-100 mb-1'
            >
              {isLost ? 'Connection lost' : 'Unstable connection'}
            </h2>
            <p className='text-sm text-muted-foreground dark:text-muted-foreground'>
              {isLost
                ? 'You appear to be offline. The recording may have stopped.'
                : 'Your connection is poor. The recording may be interrupted or stopped.'}
            </p>
          </div>
        </div>

        <div className='mt-5 flex justify-end'>
          <button
            type='button'
            onClick={onDismiss}
            className='px-4 py-2 text-sm font-medium bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors'
            data-track-category='RecordingsScreen'
            data-track-name='dismiss_connection_warning'
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
