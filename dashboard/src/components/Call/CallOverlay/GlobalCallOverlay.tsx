import { useSelector } from '@xstate/react';
import { roomActor } from '../../../machines/roomMachine';
import { createPortal } from 'react-dom';
import { RoomAudioRenderer } from '@livekit/components-react';
import { CustomLiveKitRoom } from '../CallViews/CustomLiveKitRoom';
import { useZero } from '../../../hooks/useZero';
import { useEffect } from 'react';
import { queries } from '../../../zero/queries';
import { callService } from '../../../services/Call/callService';
import { useCachedQuery } from '../../../hooks/useCachedQuery';

export function GlobalCallOverlay(): React.ReactElement | null {
  const zero = useZero();

  // Query active calls and sync to roomActor
  const [calls] = useCachedQuery(queries.userActiveCalls());

  // Sync active calls to the machine
  useEffect(() => {
    if (calls) {
      roomActor.send({ type: 'UPDATE_ACTIVE_CALLS', calls });
    }
  }, [calls]);

  // Validate new calls against LiveKit room state
  useEffect(() => {
    if (!calls || calls.length === 0) return;

    // Extract call IDs for validation
    const newCallIds = calls.map(call => call.externalId);
    void callService.validateRooms({ callIds: newCallIds });
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

      if (isInCall) {
        // Send disconnect event to clean up properly
        roomActor.send({ type: 'DISCONNECT' });
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return (): void => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  // Don't render WebView call UI when in native mode
  if (isNativeMode) {
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
      {room && <RoomAudioRenderer room={room} />}

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
