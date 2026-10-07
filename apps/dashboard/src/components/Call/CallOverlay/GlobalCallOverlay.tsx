import { useSelector } from '@xstate/react';
import { roomActor } from '../../../machines/roomMachine';
import { createPortal } from 'react-dom';
import { RoomAudioRenderer } from '@livekit/components-react';
import { CustomLiveKitRoom } from '../CallViews/CustomLiveKitRoom';
import { useZero } from '../../../hooks/useZero';
import { useEffect } from 'react';
import { queries } from '../../../zero/queries';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useAuth } from '../../../hooks/useAuth';
import { useGlobalAutoJoinOnAccept } from '../../../hooks/useCallJoinState';
import {
  getCallWindowStatus,
  isCallWindowRoute,
  isCallWindowSupported,
} from '../../../utils/callWindow';
import { isStandaloneWindow } from '../../../utils/electronApp';

interface GlobalCallOverlayProps {
  autoJoinOnAccept?: boolean;
}

export function GlobalCallOverlay({
  autoJoinOnAccept = true,
}: GlobalCallOverlayProps = {}): React.ReactElement | null {
  const zero = useZero();
  const { user } = useAuth();

  // Query active calls and sync to roomActor
  const [calls] = useCachedQuery(queries.userActiveCalls());
  useGlobalAutoJoinOnAccept(autoJoinOnAccept ? user?.id : undefined);

  // Sync active calls to the machine
  useEffect(() => {
    if (calls) {
      roomActor.send({ type: 'UPDATE_ACTIVE_CALLS', calls });
    }
  }, [calls]);

  const isCallActive = useSelector(
    roomActor,
    state =>
      state.matches('initiating') ||
      state.matches('joining') ||
      state.matches('connected') ||
      state.matches('connecting') ||
      state.matches('disconnecting'),
  );
  const isNativeMode = useSelector(roomActor, state => state.context.isNativeMode);
  const isCallWindowMode = useSelector(roomActor, state => state.context.isCallWindowMode);
  const token = useSelector(roomActor, state => state.context.token);
  const serverUrl = useSelector(roomActor, state => state.context.serverUrl);
  const callType = useSelector(roomActor, state => state.context.callType);
  const externalId = useSelector(roomActor, state => state.context.externalId);
  const room = useSelector(roomActor, state => state.context.room);

  // Handle page unload/reload - disconnect from call and update database
  useEffect(() => {
    const handleBeforeUnload = (): void => {
      const snapshot = roomActor.getSnapshot();
      const isInCall =
        snapshot.matches('initiating') ||
        snapshot.matches('joining') ||
        snapshot.matches('connecting') ||
        snapshot.matches('connected');

      // A call in the call window outlives this window reloading.
      if (isInCall && !snapshot.context.isCallWindowMode) {
        // Send disconnect event to clean up properly
        roomActor.send({ type: 'DISCONNECT' });
      }
    };

    window.addEventListener('pagehide', handleBeforeUnload);

    return (): void => {
      window.removeEventListener('pagehide', handleBeforeUnload);
    };
  }, []);

  // The main window (re)loaded while a call runs in the call window: pick it
  // back up, so the rest of the app knows there is a call.
  useEffect(() => {
    if (!isCallWindowSupported() || isStandaloneWindow()) return undefined;
    let cancelled = false;
    void getCallWindowStatus().then(status => {
      if (cancelled || !status) return;
      if (!roomActor.getSnapshot().matches('idle')) return;
      roomActor.send({ type: 'ATTACH_CALL_WINDOW', status });
    });
    return (): void => {
      cancelled = true;
    };
  }, []);

  // Don't render WebView call UI when in native mode, or when the call
  // window renders it
  if (isNativeMode || isCallWindowMode) {
    return null;
  }

  if (!isCallActive) {
    return null;
  }

  // Wait for token and serverUrl before rendering CustomLiveKitRoom
  // CustomLiveKitRoom will handle all loading states including initiating/joining
  if (!token || !serverUrl || !externalId) {
    return null;
  }

  return createPortal(
    <div className={`fixed inset-0 pointer-events-none z-[50]`}>
      {/* Global Audio Renderer - attaches all audio tracks independently of UI rendering */}
      {/* The call window renders audio from its shell, ahead of this. */}
      {room && !isCallWindowRoute() && <RoomAudioRenderer room={room} />}

      <div className='pointer-events-auto'>
        <CustomLiveKitRoom
          token={token}
          serverUrl={serverUrl}
          callId={externalId}
          callType={callType}
          externalId={externalId}
          zero={zero}
        />
      </div>
    </div>,
    document.body,
  );
}
