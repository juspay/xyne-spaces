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
import { roomActor } from '../../machines/roomMachine';
import { useAuth } from '../../hooks/useAuth';
import { CallStateTransition } from '../../components/Call/CallStateTransition/CallStateTransition';
import { GlobalCallOverlay } from '../../components/Call/CallOverlay/GlobalCallOverlay';
import { ScreenPickerHost } from '../../components/ScreenPicker/ScreenPickerHost';
import { useCallWindowNavigationGuard } from './useCallWindowNavigationGuard';

// Set by the call UI when it mounts, which is only once the app behind it has
// finished loading (InitialStateLoader holds it until then).
const CallWindowUiReadyContext = createContext<() => void>(() => undefined);

/**
 * What the window shows until the call UI is up: the call's own joining screen,
 * from the first frame. It sits above the app's loader (the logo, z-[1000]),
 * and the call UI shows this same screen while it is still connecting, so the
 * hand-over is seamless.
 */
function CallWindowJoining(): ReactElement {
  const isInitiator = useSelector(roomActor, state => state.context.isInitiator);
  return (
    <div className='fixed inset-0 z-[1001] bg-[#131314]'>
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
 * Route element for /newWindow/call. Deliberately outside SplashScreen: the
 * joining screen shows from the first frame instead of the app splash or
 * loader, and the providers (passed as children) load behind it. The call
 * itself started connecting before any of this — see utils/callWindowHost.
 */
export function CallWindowRoot({ children }: { children: ReactNode }): ReactElement {
  const { isLoading, isAuthenticated } = useAuth();
  const room = useSelector(roomActor, state => state.context.room);
  const [isUiReady, setUiReady] = useState(false);
  const markUiReady = useCallback(() => setUiReady(true), []);
  useCallWindowNavigationGuard();

  return (
    <div className='h-screen w-screen overflow-hidden bg-[#131314] text-[#e3e3e3]'>
      {/* Audio from the moment the room connects, not once the call UI has
          loaded (GlobalCallOverlay leaves it to this in the call window). */}
      {room && <RoomAudioRenderer room={room} />}
      {!isUiReady && <CallWindowJoining />}
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
      {/* Screen share from this window shows its picker here (Electron routes it). */}
      <ScreenPickerHost />
    </>
  );
}
