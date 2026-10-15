import { AudioSession } from '@livekit/react-native';
import { ConnectionState, Room, RoomEvent, Track, type LocalVideoTrack } from 'livekit-client';
import { PermissionsAndroid, Platform, type Permission } from 'react-native';
import { CallType } from '@xyne/shared';

import { isAiAgentIdentity } from '../components/call/callIdentity';
import { markCallTalkStart } from '../components/call/callTalkClock';
import { resetAppleAudioOutput } from './Call/appleAudioOutput';
import { voipForegroundServiceModule } from './VoIPForegroundServiceModule';
import { ensureLiveKitGlobals } from './LiveKitBootstrap';
import {
  resolveInitialCallMediaSettings,
  type InitialCallMediaSettings,
} from '../utils/callMediaSettings';
import { ensureMicrophonePermission, hasMicrophonePermission } from '../utils/microphonePermission';
import { errorMessage, logCallAction } from './Call/callActionLog';

export type NativeCallType = CallType;
export type CallConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

interface ActiveNativeCall {
  callId: string;
  callType: CallType;
  startedAt: number;
  roomLink?: string;
  isHost: boolean;
}

interface ConnectParams {
  callId: string;
  callType: CallType;
  token: string;
  serverUrl: string;
  roomLink?: string;
  isHost?: boolean;
  initialMicrophoneEnabled?: boolean;
  initialCameraEnabled?: boolean;
}

type Listener = (state: {
  connectionState: CallConnectionState;
  activeCall: ActiveNativeCall | null;
  participantCount: number;
  error: string | null;
}) => void;

type GoBackCallback = () => void;

export type CameraFacing = 'user' | 'environment';
type CameraFacingListener = (facing: CameraFacing) => void;

function readCameraFacing(track: LocalVideoTrack | undefined): CameraFacing | null {
  try {
    const facing = track?.mediaStreamTrack?.getSettings?.().facingMode;
    return facing === 'user' || facing === 'environment' ? facing : null;
  } catch {
    return null;
  }
}

class CallRuntimeNativeService {
  private activeCall: ActiveNativeCall | null = null;
  private room: Room | null = null;
  private listeners = new Set<Listener>();
  private connectionState: CallConnectionState = 'idle';
  private participantCount = 0;
  private error: string | null = null;
  private goBackCallback: GoBackCallback | null = null;
  private cameraFacing: CameraFacing = 'user';
  private cameraFacingListeners = new Set<CameraFacingListener>();

  constructor() {
    // When user taps "End Call" in the notification, disconnect the call
    voipForegroundServiceModule.addEndCallListener(() => {
      logCallAction('end_call', {
        callId: this.activeCall?.callId,
        source: 'android_notification',
      });
      void this.disconnect();
    });
  }

  getActiveCall(): ActiveNativeCall | null {
    return this.activeCall;
  }

  getConnectionState(): CallConnectionState {
    return this.connectionState;
  }

  getParticipantCount(): number {
    return this.participantCount;
  }

  getRoom(): Room | null {
    return this.room;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Register a callback to be called when the user goes back from the native call screen.
   * This allows the native layer to notify the web layer that it should navigate back.
   */
  setGoBackCallback(callback: GoBackCallback | null): void {
    this.goBackCallback = callback;
  }

  /**
   * Trigger the go back callback to notify the web layer.
   * Called when the user presses the back button or disconnects from a call.
   */
  goBack(): void {
    if (this.goBackCallback) {
      this.goBackCallback();
    }
  }

  async connect(params: ConnectParams): Promise<void> {
    // Lazy initialize LiveKit globals on first call
    ensureLiveKitGlobals();

    // eslint-disable-next-line no-console
    console.log('[XCALL][RT] connect()', {
      callId: params.callId,
      callType: params.callType,
      hasToken: !!params.token,
      serverUrl: params.serverUrl,
      initialMicrophoneEnabled: params.initialMicrophoneEnabled,
      initialCameraEnabled: params.initialCameraEnabled,
    });

    const requestedMediaSettings = resolveInitialCallMediaSettings(params.callType, {
      ...(params.initialMicrophoneEnabled !== undefined
        ? { microphoneEnabled: params.initialMicrophoneEnabled }
        : {}),
      ...(params.initialCameraEnabled !== undefined
        ? { cameraEnabled: params.initialCameraEnabled }
        : {}),
    });

    const initialMediaSettings = await this.resolveMediaPermissions(requestedMediaSettings);
    logCallAction('join_media', {
      callId: params.callId,
      callType: params.callType,
      requested: requestedMediaSettings,
      resolved: initialMediaSettings,
    });
    await this.cleanupRoom();

    this.activeCall = {
      callId: params.callId,
      callType: params.callType,
      startedAt: Date.now(),
      isHost: params.isHost ?? false,
      ...(params.roomLink ? { roomLink: params.roomLink } : {}),
    };
    this.connectionState = 'connecting';
    this.participantCount = 0;
    this.error = null;
    this.notify();

    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
    });
    this.room = room;
    this.bindRoomEvents(room);
    try {
      resetAppleAudioOutput();
      try {
        await AudioSession.startAudioSession();
      } catch (audioSessionError) {
        // On iOS incoming-call flows, CallKit may already own/activate the audio session.
        // Don't block room join on activation conflicts.
        if (Platform.OS === 'ios') {
          // eslint-disable-next-line no-console
          console.warn(
            '[LiveKit] AudioSession.startAudioSession failed on iOS, continuing with CallKit-managed audio session',
            {
              error:
                audioSessionError instanceof Error ? audioSessionError.message : audioSessionError,
            },
          );
        } else {
          throw audioSessionError;
        }
      }
      await this.startCallService('join');
      await room.connect(params.serverUrl, params.token, { autoSubscribe: true });
      // eslint-disable-next-line no-console
      console.log('[XCALL][RT] LiveKit connected', {
        callId: params.callId,
        remoteParticipants: room.remoteParticipants.size,
      });
      this.connectionState = 'connected';
      this.participantCount = room.remoteParticipants.size + 1;
      this.markTalkStartIfAnswered(room);
      this.notify();
      void this.enableLocalTracks(room, initialMediaSettings);
    } catch (error) {
      this.connectionState = 'error';
      this.error = error instanceof Error ? error.message : 'Connection failed';
      // eslint-disable-next-line no-console
      console.warn('[XCALL][RT] connect() FAILED', {
        callId: params.callId,
        error: error instanceof Error ? error.message : String(error),
      });
      this.notify();
      await this.cleanupRoom();
      this.activeCall = null;
      this.participantCount = 0;
      await voipForegroundServiceModule.stop();
      await AudioSession.stopAudioSession().catch(() => {
        // ignore cleanup errors when session was never activated by us
      });
      throw error;
    }
  }

  private async enableLocalTracks(room: Room, settings: InitialCallMediaSettings): Promise<void> {
    if (this.room !== room) {
      return;
    }

    if (settings.microphoneEnabled) {
      try {
        await room.localParticipant.setMicrophoneEnabled(true);
        logCallAction('join_mic_enabled', { callId: this.activeCall?.callId });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (
          this.room === room &&
          this.connectionState === 'connected' &&
          message.toLowerCase().includes('engine not connected')
        ) {
          await new Promise(resolve => setTimeout(resolve, 600));
          try {
            await room.localParticipant.setMicrophoneEnabled(true);
          } catch (retryError) {
            logCallAction(
              'join_mic_enabled',
              {
                callId: this.activeCall?.callId,
                outcome: 'failed',
                error: errorMessage(retryError),
              },
              'error',
            );
          }
        } else {
          logCallAction(
            'join_mic_enabled',
            { callId: this.activeCall?.callId, outcome: 'failed', error: message },
            'error',
          );
        }
      }
    }

    if (!settings.cameraEnabled || this.room !== room) {
      return;
    }

    try {
      await room.localParticipant.setCameraEnabled(true);
      logCallAction('join_camera_enabled', { callId: this.activeCall?.callId });
    } catch (error) {
      logCallAction(
        'join_camera_enabled',
        { callId: this.activeCall?.callId, outcome: 'failed', error: errorMessage(error) },
        'error',
      );
    }
  }

  async disconnect(): Promise<void> {
    // eslint-disable-next-line no-console
    console.log('[XCALL][RT] disconnect()', { callId: this.activeCall?.callId });
    logCallAction('disconnect', { callId: this.activeCall?.callId });
    await this.cleanupRoom();
    this.activeCall = null;
    this.connectionState = 'disconnected';
    this.participantCount = 0;
    this.error = null;
    this.notify();
    await voipForegroundServiceModule.stop();
    await AudioSession.stopAudioSession().catch(() => {
      // ignore cleanup errors when session was never activated by us
    });
  }

  async toggleMic(enabled: boolean): Promise<void> {
    const callId = this.activeCall?.callId;
    if (!this.room) {
      logCallAction('mic_toggle', { callId, enabled, outcome: 'no_room' }, 'warn');
      return;
    }
    let permission: string | undefined;
    let serviceRestarted = false;
    try {
      if (enabled) {
        const room = this.room;
        const hadPermission = await hasMicrophonePermission();
        permission = hadPermission ? 'already_granted' : await ensureMicrophonePermission();
        if (permission !== 'already_granted' && permission !== 'granted') {
          logCallAction('mic_toggle', {
            callId,
            enabled,
            permission,
            outcome: 'permission_denied',
          });
          return;
        }
        if (this.room !== room) {
          logCallAction('mic_toggle', { callId, enabled, permission, outcome: 'room_changed' });
          return;
        }
        // Joined without mic access: the Android ongoing-call service was started without the
        // microphone type, so restart it with mic access or capture stops once backgrounded.
        if (!hadPermission && this.activeCall) {
          await this.startCallService('mic_granted');
          serviceRestarted = true;
        }
      }
      await this.room.localParticipant.setMicrophoneEnabled(enabled);
      logCallAction('mic_toggle', {
        callId,
        enabled,
        permission,
        serviceRestarted,
        outcome: 'ok',
        micEnabled: this.room?.localParticipant.isMicrophoneEnabled,
      });
    } catch (error) {
      logCallAction(
        'mic_toggle',
        { callId, enabled, permission, outcome: 'failed', error: errorMessage(error) },
        'error',
      );
      throw error;
    }
  }

  async toggleCamera(enabled: boolean): Promise<void> {
    const callId = this.activeCall?.callId;
    if (!this.room) {
      logCallAction('camera_toggle', { callId, enabled, outcome: 'no_room' }, 'warn');
      return;
    }
    try {
      if (enabled) {
        await this.ensureCameraPermission();
      }
      await this.room.localParticipant.setCameraEnabled(enabled);
      logCallAction('camera_toggle', {
        callId,
        enabled,
        outcome: 'ok',
        cameraEnabled: this.room?.localParticipant.isCameraEnabled,
      });
    } catch (error) {
      logCallAction(
        'camera_toggle',
        { callId, enabled, outcome: 'failed', error: errorMessage(error) },
        'error',
      );
      throw error;
    }
  }

  async toggleScreenShare(enabled: boolean): Promise<void> {
    const callId = this.activeCall?.callId;
    if (!this.room) {
      logCallAction('screen_share_toggle', { callId, enabled, outcome: 'no_room' }, 'warn');
      return;
    }
    try {
      await this.room.localParticipant.setScreenShareEnabled(enabled);
      logCallAction('screen_share_toggle', {
        callId,
        enabled,
        outcome: 'ok',
        screenShareEnabled: this.room?.localParticipant.isScreenShareEnabled,
      });
    } catch (error) {
      // User cancelled the screen share picker or permission was denied
      logCallAction(
        'screen_share_toggle',
        { callId, enabled, outcome: 'cancelled_or_failed', error: errorMessage(error) },
        'warn',
      );
    }
  }

  /** Which lens the published camera is using; drives self-view mirroring. */
  getCameraFacing(): CameraFacing {
    return this.cameraFacing;
  }

  subscribeCameraFacing(listener: CameraFacingListener): () => void {
    this.cameraFacingListeners.add(listener);
    return () => {
      this.cameraFacingListeners.delete(listener);
    };
  }

  private setCameraFacing(facing: CameraFacing): void {
    if (this.cameraFacing === facing) return;
    this.cameraFacing = facing;
    this.cameraFacingListeners.forEach(listener => {
      listener(facing);
    });
  }

  /** Swaps between the front and back camera without unpublishing the track. */
  async flipCamera(): Promise<void> {
    const callId = this.activeCall?.callId;
    const room = this.room;
    if (!room) {
      logCallAction('camera_flip', { callId, outcome: 'no_room' }, 'warn');
      return;
    }
    const videoTrack = room.localParticipant.getTrackPublication(Track.Source.Camera)?.videoTrack;
    if (!videoTrack) {
      logCallAction('camera_flip', { callId, outcome: 'no_camera_track' }, 'warn');
      return;
    }
    const next: CameraFacing =
      (readCameraFacing(videoTrack) ?? this.cameraFacing) === 'environment'
        ? 'user'
        : 'environment';
    try {
      await videoTrack.restartTrack({ facingMode: next });
      this.setCameraFacing(readCameraFacing(videoTrack) ?? next);
      logCallAction('camera_flip', { callId, facing: this.cameraFacing, outcome: 'ok' });
    } catch (error) {
      logCallAction(
        'camera_flip',
        { callId, facing: next, outcome: 'failed', error: errorMessage(error) },
        'error',
      );
    }
  }

  isMicEnabled(): boolean {
    return this.room?.localParticipant?.isMicrophoneEnabled ?? false;
  }

  isCameraEnabled(): boolean {
    return this.room?.localParticipant?.isCameraEnabled ?? false;
  }

  isScreenShareEnabled(): boolean {
    return this.room?.localParticipant?.isScreenShareEnabled ?? false;
  }

  async markConnecting(callId: string, callType: CallType, isHost = false): Promise<void> {
    this.activeCall = { callId, callType, startedAt: Date.now(), isHost };
    this.connectionState = 'connecting';
    this.notify();
    await this.startCallService('mark_connecting');
  }

  async markDisconnected(): Promise<void> {
    await this.cleanupRoom();
    this.activeCall = null;
    this.connectionState = 'disconnected';
    this.participantCount = 0;
    this.error = null;
    this.notify();
    await voipForegroundServiceModule.stop();
    await AudioSession.stopAudioSession().catch(() => {
      // ignore cleanup errors when session was never activated by us
    });
  }

  private snapshot(): {
    connectionState: CallConnectionState;
    activeCall: ActiveNativeCall | null;
    participantCount: number;
    error: string | null;
  } {
    return {
      connectionState: this.connectionState,
      activeCall: this.activeCall,
      participantCount: this.participantCount,
      error: this.error,
    };
  }

  private notify(): void {
    const snapshot = this.snapshot();
    this.listeners.forEach(listener => {
      listener(snapshot);
    });
  }

  /**
   * Starts the call's talk clock the first time another person is in the room. Done here, not in
   * the call screen, so it is recorded even while the screen is minimised.
   */
  private markTalkStartIfAnswered(room: Room): void {
    const call = this.activeCall;
    if (!call) return;
    const answered = Array.from(room.remoteParticipants.values()).some(
      p => !isAiAgentIdentity(p.identity),
    );
    if (answered) markCallTalkStart(call.callId, call.startedAt);
  }

  private bindRoomEvents(room: Room): void {
    room.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
      // eslint-disable-next-line no-console
      console.log('[XCALL][RT] RoomEvent.ConnectionStateChanged', {
        state,
        callId: this.activeCall?.callId,
      });
      if (state === ConnectionState.Connected) {
        this.connectionState = 'connected';
      } else if (state === ConnectionState.Reconnecting || state === ConnectionState.Connecting) {
        this.connectionState = 'connecting';
      } else if (state === ConnectionState.Disconnected) {
        this.connectionState = 'disconnected';
        this.activeCall = null;
        void voipForegroundServiceModule.stop();
        void AudioSession.stopAudioSession().catch(() => {});
      }
      this.notify();
    });

    room.on(RoomEvent.ParticipantConnected, () => {
      // eslint-disable-next-line no-console
      console.log('[XCALL][RT] RoomEvent.ParticipantConnected', {
        callId: this.activeCall?.callId,
        total: room.remoteParticipants.size + 1,
      });
      this.participantCount = room.remoteParticipants.size + 1;
      this.markTalkStartIfAnswered(room);
      this.notify();
    });
    room.on(RoomEvent.ParticipantDisconnected, () => {
      // eslint-disable-next-line no-console
      console.log('[XCALL][RT] RoomEvent.ParticipantDisconnected', {
        callId: this.activeCall?.callId,
        remaining: room.remoteParticipants.size + 1,
      });
      this.participantCount = room.remoteParticipants.size + 1;
      this.notify();
    });

    room.on(RoomEvent.Disconnected, () => {
      // eslint-disable-next-line no-console
      console.log('[XCALL][RT] RoomEvent.Disconnected (remote/server closed room)', {
        callId: this.activeCall?.callId,
        prevState: this.connectionState,
      });
      if (this.connectionState !== 'disconnected') {
        this.connectionState = 'disconnected';
        this.activeCall = null;
        void voipForegroundServiceModule.stop();
        void AudioSession.stopAudioSession().catch(() => {});
      }
      this.notify();
    });

    // Local track published/unpublished — mic, camera, or screen share enabled/disabled
    // Logged too: this is the only signal for changes made outside our buttons, e.g. an iOS
    // broadcast stopped from Control Center or a track the server unpublished.
    room.on(RoomEvent.LocalTrackPublished, publication => {
      logCallAction('local_track_published', {
        callId: this.activeCall?.callId,
        source: 'room_event',
        track: publication.source,
      });
      this.notify();
    });
    room.on(RoomEvent.LocalTrackUnpublished, publication => {
      logCallAction('local_track_unpublished', {
        callId: this.activeCall?.callId,
        source: 'room_event',
        track: publication.source,
      });
      // A fresh camera publish starts on the front lens again.
      if (publication.source === Track.Source.Camera) {
        this.setCameraFacing('user');
      }
      this.notify();
    });

    // Remote participant track published/unpublished — camera/screen share state for grid
    room.on(RoomEvent.TrackPublished, () => {
      this.notify();
    });
    room.on(RoomEvent.TrackUnpublished, () => {
      this.notify();
    });

    // Track mute/unmute events for mic state propagation
    room.on(RoomEvent.TrackMuted, (publication, participant) => {
      if (participant === room.localParticipant) {
        logCallAction('local_track_muted', {
          callId: this.activeCall?.callId,
          source: 'room_event',
          track: publication.source,
        });
      }
      this.notify();
    });
    room.on(RoomEvent.TrackUnmuted, (publication, participant) => {
      if (participant === room.localParticipant) {
        logCallAction('local_track_unmuted', {
          callId: this.activeCall?.callId,
          source: 'room_event',
          track: publication.source,
        });
      }
      this.notify();
    });
  }

  /**
   * Requests the permissions the requested initial media needs and turns off whatever was
   * denied, so a participant without mic/camera access still joins (muted / camera off)
   * instead of the call failing. They can grant mic access later by tapping unmute.
   */
  private async resolveMediaPermissions(
    settings: InitialCallMediaSettings,
  ): Promise<InitialCallMediaSettings> {
    if (Platform.OS !== 'android') {
      return settings;
    }

    // Older binaries declare the call service as microphone-only, which Android 14+ refuses
    // to start without RECORD_AUDIO, so on those mic access is still required to join.
    const micRequired = !voipForegroundServiceModule.supportsCallWithoutMicrophone();
    const permissions: Permission[] = [];
    if (settings.microphoneEnabled || micRequired) {
      permissions.push(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    }
    if (settings.cameraEnabled) {
      permissions.push(PermissionsAndroid.PERMISSIONS.CAMERA);
    }
    if (permissions.length === 0) {
      return settings;
    }

    const result = await PermissionsAndroid.requestMultiple(permissions);
    const isGranted = (permission: Permission): boolean =>
      result[permission] === PermissionsAndroid.RESULTS.GRANTED;

    if (micRequired && !isGranted(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO)) {
      throw new Error('Missing required permissions: RECORD_AUDIO');
    }

    return {
      microphoneEnabled:
        settings.microphoneEnabled && isGranted(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO),
      cameraEnabled: settings.cameraEnabled && isGranted(PermissionsAndroid.PERMISSIONS.CAMERA),
    };
  }

  /** Starts (or restarts) the Android ongoing-call service and logs which type it ran as. */
  private async startCallService(reason: string): Promise<void> {
    const serviceType = await voipForegroundServiceModule.start(this.activeCall?.startedAt);
    if (serviceType !== undefined) {
      logCallAction('android_call_service_started', {
        callId: this.activeCall?.callId,
        reason,
        serviceType,
      });
    }
  }

  private async ensureCameraPermission(): Promise<void> {
    if (Platform.OS !== 'android') {
      return;
    }
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
    if (result !== PermissionsAndroid.RESULTS.GRANTED) {
      throw new Error('Missing required permissions: CAMERA');
    }
  }

  private async cleanupRoom(): Promise<void> {
    if (!this.room) {
      return;
    }

    try {
      await this.room.disconnect();
    } catch {
      // ignore disconnect errors during cleanup
    } finally {
      this.room = null;
      this.setCameraFacing('user');
    }
  }
}

export const callRuntimeNativeService = new CallRuntimeNativeService();
