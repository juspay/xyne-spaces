import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useSelector } from '@xstate/react';
import { ConnectionState } from 'livekit-client';
import { RoomAudioRenderer } from '@livekit/components-react';
import { roomActor } from '../machines/roomMachine';
import { useAuth } from '../hooks/useAuth';
import { CallStateTransition } from '../components/Call/CallStateTransition/CallStateTransition';
import { GlobalCallOverlay } from '../components/Call/CallOverlay/GlobalCallOverlay';
import { ScreenPickerModal } from '../components/ScreenPicker/ScreenPickerModal';
import { useCallWindowNavigationGuard } from './useCallWindowNavigationGuard';

// Set by the call UI once it shows the call: signed in, Zero up and the handoff
// received. The workspace data loads behind it (InitialStateLoader in
// renderBeforeLoaded mode, see CallWindowApp).
const CallWindowUiReadyContext = createContext<() => void>(() => undefined);

/**
 * What the window shows until the call UI is up: the call's own joining screen,
 * from the first frame. The call UI shows this same screen while it is still
 * connecting, so the hand-over is seamless.
 */
function CallWindowJoining(): ReactElement {
  const isInitiator = useSelector(roomActor, state => state.context.isInitiator);
  return (
    <div className='fixed inset-0 bg-[#131314]'>
      <CallStateTransition
        connectionState={ConnectionState.Connecting}
        machineState={isInitiator ? 'initiating' : 'joining'}
      >
        {null}
      </CallStateTransition>
    </div>
  );
}

/**
 * The call window page's root (see CallWindowApp). The joining screen shows
 * from the first frame, and the providers (passed as children) load behind it.
 * The call itself started connecting before any of this — see
 * utils/callWindowHost.
 */
/**
 * Signing in failed (session expired or revoked while the window was kept).
 * The call may still be connected, since it needs only the handed-over token,
 * so offer a way out rather than a "joining" screen that never ends.
 */
function CallWindowSignInError(): ReactElement {
  const isInCall = useSelector(roomActor, state => !state.matches('idle'));
  return (
    <div className='fixed inset-0 flex flex-col items-center justify-center gap-4 bg-[#131314] px-6 text-center'>
      <p className='text-base font-medium'>Could not load the call</p>
      <p className='max-w-sm text-sm text-[#e3e3e3]/70'>
        You are signed out in this window. Sign in again from the main window and rejoin.
      </p>
      <button
        type='button'
        data-track-category='CALLS'
        data-track-name='CALL_WINDOW_SIGNED_OUT_LEAVE'
        className='rounded-md bg-[#e3e3e3] px-4 py-2 text-sm font-medium text-[#131314] hover:bg-[#e3e3e3]/90'
        onClick={() => {
          if (isInCall) roomActor.send({ type: 'DISCONNECT' });
          else window.close();
        }}
      >
        {isInCall ? 'Leave call' : 'Close'}
      </button>
    </div>
  );
}

export function CallWindowRoot({ children }: { children: ReactNode }): ReactElement {
  const { isLoading, isAuthenticated } = useAuth();
  const isSignInFailed = !isLoading && !isAuthenticated;
  const room = useSelector(roomActor, state => state.context.room);
  const [isUiReady, setUiReady] = useState(false);
  const markUiReady = useCallback(() => setUiReady(true), []);
  useCallWindowNavigationGuard();

  // Electron keeps this window, hidden, after a call ends. Back to the joining
  // screen when it is brought out again for the next call, so that call opens
  // onto it and not a blank window. Not as soon as the call goes idle: that is
  // also the moment the user left, and "Joining call…" would flash up while
  // the window is on its way out.
  useEffect(() => window.electronAPI?.callWindow?.onPreparing?.(() => setUiReady(false)), []);
  // A join started from inside this window (e.g. "Switch" on a call card)
  // shows the joining screen too, until that call is up.
  const isJoiningHere = useSelector(
    roomActor,
    state => state.matches('initiating') || state.matches('joining'),
  );
  useEffect(() => {
    if (isJoiningHere) setUiReady(false);
  }, [isJoiningHere]);

  return (
    <div className='h-screen w-screen overflow-hidden bg-[#131314] text-[#e3e3e3]'>
      {/* Audio from the moment the room connects, not once the call UI has
          loaded (GlobalCallOverlay leaves it to this in the call window). */}
      {room && <RoomAudioRenderer room={room} />}
      {isSignInFailed ? <CallWindowSignInError /> : !isUiReady && <CallWindowJoining />}
      {!isLoading && isAuthenticated && (
        <CallWindowUiReadyContext.Provider value={markUiReady}>
          {children}
        </CallWindowUiReadyContext.Provider>
      )}
    </div>
  );
}

/**
 * The desktop call window's UI. Electron opens the window when a call starts in
 * the main window with "Open calls in a separate window" on, and the call UI
 * renders here full size. See utils/callWindow for the protocol.
 */
export default function CallWindowScreen(): ReactElement {
  const markUiReady = useContext(CallWindowUiReadyContext);
  // GlobalCallOverlay renders once there is a call with a token; until the
  // handoff lands it renders nothing, so the joining screen must stay up.
  const isShowingCall = useSelector(
    roomActor,
    state => !state.matches('idle') && !!state.context.token,
  );
  useEffect(() => {
    if (isShowingCall) markUiReady();
  }, [isShowingCall, markUiReady]);

  return (
    <>
      {/* roomActor is a module singleton, so this window needs its own overlay. */}
      <GlobalCallOverlay autoJoinOnAccept={false} />
      {/* Screen share from this window shows its picker here (Electron routes it).
          The modal alone, not ScreenPickerHost: its flag hook reports to Electron,
          where the flag is session wide, and the main window already owns it. */}
      <ScreenPickerModal />
    </>
  );
}
