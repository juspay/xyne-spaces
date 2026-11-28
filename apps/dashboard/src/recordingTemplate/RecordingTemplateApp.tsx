import { useEffect, useState, type ReactElement } from 'react';
import {
  CarouselLayout,
  FocusLayout,
  FocusLayoutContainer,
  GridLayout,
  ParticipantTile,
  RoomAudioRenderer,
  RoomContext,
  useTracks,
} from '@livekit/components-react';
import axios from 'axios';
import { Room, RoomEvent, Track } from 'livekit-client';
import type { CallEncryptionCredentials } from '@xyne/shared';
import { API_BASE_URL } from '../config';
import {
  applyRoomEncryption,
  attachRoomEncryption,
  createRoomEncryptionOptions,
} from '../utils/callEncryption';
import { endRecording, readEgressParams, startRecording, type EgressParams } from './egress';

/** Start recording this long after joining even if nobody publishes anything yet. */
const START_WITHOUT_TRACKS_MS = 3_000;

type JoinState =
  | { status: 'joining' }
  | { status: 'joined'; room: Room }
  | { status: 'failed'; reason: string };

/**
 * The call key for the egress recording this call. The backend releases it only to egress's
 * own token (recorder grant) while the call is being recorded. Plain axios, not the app's API
 * client: egress has no session, and the client's session and encryption interceptors don't apply.
 */
async function fetchCallKey(
  token: string,
): Promise<{ roomName: string; credentials: CallEncryptionCredentials }> {
  const { data } = await axios.post<{ roomName: string; credentials: CallEncryptionCredentials }>(
    `${API_BASE_URL}/recording-template/call-key`,
    { token },
    { withCredentials: false },
  );
  return data;
}

/** Join the call with its key, so every track egress records is decrypted. */
async function joinEncrypted(params: EgressParams): Promise<Room> {
  const { roomName, credentials } = await fetchCallKey(params.token);
  const encryption = createRoomEncryptionOptions();
  // Egress records at one fixed size: take every track at full quality.
  const room = new Room({ adaptiveStream: false, dynacast: false, encryption });
  attachRoomEncryption(room, encryption);
  await applyRoomEncryption(room, credentials, roomName);
  await room.connect(params.url, params.token, { autoSubscribe: true });
  return room;
}

/**
 * Speaker layout ('speaker-dark', Screen + voice): the newest screen share large with the
 * cameras beside it; without a share, the cameras in a grid. Grid layout ('grid-dark',
 * Audio + video): every screen share and camera in a grid.
 */
function CallLayout({ layout }: { layout: string }): ReactElement {
  const tracks = useTracks(
    [
      { source: Track.Source.ScreenShare, withPlaceholder: false },
      { source: Track.Source.Camera, withPlaceholder: true },
    ],
    { onlySubscribed: false },
    // The local participant is the recorder itself (hidden egress): never a tile.
  ).filter(t => !t.participant.isLocal);
  const screenShares = tracks.filter(t => t.source === Track.Source.ScreenShare);
  const cameras = tracks.filter(t => t.source !== Track.Source.ScreenShare);
  const focus = layout.startsWith('speaker') ? screenShares[screenShares.length - 1] : undefined;

  if (focus) {
    return (
      <FocusLayoutContainer className='recording-template__focus'>
        <FocusLayout trackRef={focus} />
        {cameras.length > 0 && (
          <CarouselLayout tracks={cameras} orientation='vertical'>
            <ParticipantTile />
          </CarouselLayout>
        )}
      </FocusLayoutContainer>
    );
  }
  return (
    <GridLayout tracks={layout.startsWith('speaker') ? cameras : [...screenShares, ...cameras]}>
      <ParticipantTile />
    </GridLayout>
  );
}

export default function RecordingTemplateApp(): ReactElement {
  const [state, setState] = useState<JoinState>({ status: 'joining' });

  useEffect(() => {
    const params = readEgressParams();
    if (!params) {
      setState({ status: 'failed', reason: 'Missing egress parameters' });
      return undefined;
    }
    let room: Room | undefined;
    let cancelled = false;
    let fallback: ReturnType<typeof setTimeout> | undefined;

    joinEncrypted(params)
      .then(joined => {
        if (cancelled) {
          void joined.disconnect();
          return;
        }
        room = joined;
        setState({ status: 'joined', room: joined });
        // Start once there is something to record, or after a short wait for a silent call.
        if (joined.remoteParticipants.size > 0) {
          startRecording();
        }
        joined.on(RoomEvent.TrackSubscribed, startRecording);
        fallback = setTimeout(startRecording, START_WITHOUT_TRACKS_MS);
        joined.on(RoomEvent.Disconnected, endRecording);
      })
      .catch((error: unknown) => {
        // Nothing decrypted can be recorded: end the egress rather than record silence.
        const reason = error instanceof Error ? error.message : String(error);
        // eslint-disable-next-line no-console -- the only trace of why, when debugging the page
        console.error(`recording template: could not join the call: ${reason}`);
        setState({ status: 'failed', reason });
        endRecording();
      });

    return (): void => {
      cancelled = true;
      if (fallback) {
        clearTimeout(fallback);
      }
      void room?.disconnect();
    };
  }, []);

  if (state.status !== 'joined') {
    // Visible in egress logs/screenshots only; never part of a successful recording.
    return (
      <div className='recording-template__status'>
        {state.status === 'failed' ? state.reason : ''}
      </div>
    );
  }
  return (
    <RoomContext.Provider value={state.room}>
      <div className='lk-room-container recording-template' data-lk-theme='default'>
        <CallLayout layout={readEgressParams()?.layout ?? 'grid-dark'} />
        <RoomAudioRenderer />
      </div>
    </RoomContext.Provider>
  );
}
