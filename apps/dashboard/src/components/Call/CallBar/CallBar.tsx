import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Mic, MicOff, PhoneOff, Video, VideoOff } from 'lucide-react';
import {
  isCallWindowActive,
  requestCallWindowState,
  sendCallWindowCommand,
  subscribeCallWindowChannel,
  type CallWindowState,
} from '../../../utils/callWindowChannel';
import { focusCallWindow } from '../../../utils/electronApp';

export function CallBar(): React.ReactElement | null {
  const [state, setState] = useState<CallWindowState | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeCallWindowChannel({
      onState: setState,
      onEnded: () => setState(null),
    });
    requestCallWindowState();
    const staleTimer = setInterval(() => {
      if (!isCallWindowActive()) setState(null);
    }, 5000);
    return () => {
      clearInterval(staleTimer);
      unsubscribe();
    };
  }, []);

  if (!state) return null;

  return createPortal(
    <div className='pointer-events-none fixed inset-x-0 bottom-4 z-[45] flex justify-center'>
      <div className='pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-popover px-3 py-2 text-popover-foreground shadow-lg'>
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${
            state.connected ? 'bg-emerald-500' : 'bg-amber-500'
          }`}
          aria-hidden
        />
        <button
          type='button'
          onClick={focusCallWindow}
          className='max-w-[220px] truncate text-sm font-medium'
          title='Return to call'
          data-track-category='CALLS'
          data-track-name='Call_Bar_Return_To_Call'
        >
          {state.title ?? 'Call in progress'}
        </button>

        <div className='mx-1 h-4 w-px bg-border' aria-hidden />

        <button
          type='button'
          aria-label={state.micEnabled ? 'Mute microphone' : 'Unmute microphone'}
          onClick={() => sendCallWindowCommand('toggle-mic')}
          data-track-category='CALLS'
          data-track-name='Call_Bar_Toggle_Mic'
          className='flex h-7 w-7 items-center justify-center rounded-full hover:bg-muted'
        >
          {state.micEnabled ? <Mic size={15} /> : <MicOff size={15} className='text-destructive' />}
        </button>
        <button
          type='button'
          aria-label={state.cameraEnabled ? 'Turn off camera' : 'Turn on camera'}
          onClick={() => sendCallWindowCommand('toggle-camera')}
          data-track-category='CALLS'
          data-track-name='Call_Bar_Toggle_Camera'
          className='flex h-7 w-7 items-center justify-center rounded-full hover:bg-muted'
        >
          {state.cameraEnabled ? (
            <Video size={15} />
          ) : (
            <VideoOff size={15} className='text-muted-foreground' />
          )}
        </button>
        <button
          type='button'
          aria-label='Leave call'
          onClick={() => sendCallWindowCommand('leave')}
          data-track-category='CALLS'
          data-track-name='Call_Bar_Leave'
          className='flex h-7 w-7 items-center justify-center rounded-full bg-destructive text-destructive-foreground'
        >
          <PhoneOff size={14} />
        </button>
      </div>
    </div>,
    document.body,
  );
}
