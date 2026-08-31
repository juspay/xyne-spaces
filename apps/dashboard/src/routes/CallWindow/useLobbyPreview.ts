import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createLocalAudioTrack,
  createLocalVideoTrack,
  type LocalAudioTrack,
  type LocalVideoTrack,
} from 'livekit-client';
import { MACOS_PRIVACY_URLS } from '../../constants/permissions';
import { isElectronApp } from '../../utils/electronApp';

export type DeviceKind = 'mic' | 'camera';

export type PermissionState = 'unknown' | 'granted' | 'denied' | 'prompt';

export interface LobbyPreviewState {
  micOn: boolean;
  cameraOn: boolean;
  micTrack: LocalAudioTrack | null;
  cameraTrack: LocalVideoTrack | null;
  micPermission: PermissionState;
  cameraPermission: PermissionState;
  micDevices: MediaDeviceInfo[];
  cameraDevices: MediaDeviceInfo[];
  speakerDevices: MediaDeviceInfo[];
  micDeviceId: string | null;
  cameraDeviceId: string | null;
  speakerDeviceId: string | null;
  setMicOn: (on: boolean) => void;
  setCameraOn: (on: boolean) => void;
  selectMicDevice: (deviceId: string) => void;
  selectCameraDevice: (deviceId: string) => void;
  selectSpeakerDevice: (deviceId: string) => void;
  stopPreview: () => void;
  releaseTracks: () => void;
  openSystemSettings: (kind: DeviceKind) => void;
}

interface UseLobbyPreviewOptions {
  initialMicOn: boolean;
  initialCameraOn: boolean;
  initialMicDeviceId: string | null;
  initialCameraDeviceId: string | null;
  initialSpeakerDeviceId: string | null;
  autoStart: boolean;
}

const isPermissionDenied = (error: unknown): boolean =>
  error instanceof Error &&
  (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError');

export function useLobbyPreview(options: UseLobbyPreviewOptions): LobbyPreviewState {
  const [micOn, setMicOnState] = useState(options.initialMicOn);
  const [cameraOn, setCameraOnState] = useState(options.initialCameraOn);
  const [micTrack, setMicTrack] = useState<LocalAudioTrack | null>(null);
  const [cameraTrack, setCameraTrack] = useState<LocalVideoTrack | null>(null);
  const [micPermission, setMicPermission] = useState<PermissionState>('unknown');
  const [cameraPermission, setCameraPermission] = useState<PermissionState>('unknown');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [micDeviceId, setMicDeviceId] = useState<string | null>(options.initialMicDeviceId);
  const [cameraDeviceId, setCameraDeviceId] = useState<string | null>(
    options.initialCameraDeviceId,
  );
  const [speakerDeviceId, setSpeakerDeviceId] = useState<string | null>(
    options.initialSpeakerDeviceId,
  );

  const micTrackRef = useRef<LocalAudioTrack | null>(null);
  const cameraTrackRef = useRef<LocalVideoTrack | null>(null);
  const releasedRef = useRef(false);
  const micTokenRef = useRef(0);
  const cameraTokenRef = useRef(0);

  micTrackRef.current = micTrack;
  cameraTrackRef.current = cameraTrack;

  const refreshDevices = useCallback(async (): Promise<void> => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list);
    } catch {
      // Enumeration fails before any permission is granted; the lobby still works.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const probe = async (): Promise<void> => {
      if (!navigator.permissions?.query) return;
      const read = async (name: string): Promise<PermissionState> => {
        try {
          const status = await navigator.permissions.query({
            name: name as PermissionName,
          });
          return status.state as PermissionState;
        } catch {
          return 'unknown';
        }
      };
      const [mic, camera] = await Promise.all([read('microphone'), read('camera')]);
      if (cancelled) return;
      setMicPermission(mic);
      setCameraPermission(camera);
    };
    void probe();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void refreshDevices();
    const onChange = (): void => void refreshDevices();
    navigator.mediaDevices?.addEventListener?.('devicechange', onChange);
    return () => {
      navigator.mediaDevices?.removeEventListener?.('devicechange', onChange);
    };
  }, [refreshDevices]);

  const stopMic = useCallback(() => {
    micTrackRef.current?.stop();
    micTrackRef.current = null;
    setMicTrack(null);
  }, []);

  const stopCamera = useCallback(() => {
    cameraTrackRef.current?.stop();
    cameraTrackRef.current = null;
    setCameraTrack(null);
  }, []);

  const startMic = useCallback(
    async (deviceId: string | null): Promise<void> => {
      const token = ++micTokenRef.current;
      try {
        const track = await createLocalAudioTrack(
          deviceId ? { deviceId: { exact: deviceId } } : {},
        );
        if (releasedRef.current || token !== micTokenRef.current) {
          track.stop();
          return;
        }
        stopMic();
        micTrackRef.current = track;
        setMicTrack(track);
        setMicPermission('granted');
        void refreshDevices();
      } catch (error) {
        if (token !== micTokenRef.current) return;
        setMicOnState(false);
        if (isPermissionDenied(error)) setMicPermission('denied');
      }
    },
    [refreshDevices, stopMic],
  );

  const startCamera = useCallback(
    async (deviceId: string | null): Promise<void> => {
      const token = ++cameraTokenRef.current;
      try {
        const track = await createLocalVideoTrack(
          deviceId ? { deviceId: { exact: deviceId } } : {},
        );
        if (releasedRef.current || token !== cameraTokenRef.current) {
          track.stop();
          return;
        }
        stopCamera();
        cameraTrackRef.current = track;
        setCameraTrack(track);
        setCameraPermission('granted');
        void refreshDevices();
      } catch (error) {
        if (token !== cameraTokenRef.current) return;
        setCameraOnState(false);
        if (isPermissionDenied(error)) setCameraPermission('denied');
      }
    },
    [refreshDevices, stopCamera],
  );

  const setMicOn = useCallback(
    (on: boolean) => {
      setMicOnState(on);
      if (on) {
        void startMic(micDeviceId);
      } else {
        micTokenRef.current += 1;
        stopMic();
      }
    },
    [micDeviceId, startMic, stopMic],
  );

  const setCameraOn = useCallback(
    (on: boolean) => {
      setCameraOnState(on);
      if (on) {
        void startCamera(cameraDeviceId);
      } else {
        cameraTokenRef.current += 1;
        stopCamera();
      }
    },
    [cameraDeviceId, startCamera, stopCamera],
  );

  const selectMicDevice = useCallback(
    (deviceId: string) => {
      setMicDeviceId(deviceId);
      if (micOn) void startMic(deviceId);
    },
    [micOn, startMic],
  );

  const selectCameraDevice = useCallback(
    (deviceId: string) => {
      setCameraDeviceId(deviceId);
      if (cameraOn) void startCamera(deviceId);
    },
    [cameraOn, startCamera],
  );

  const selectSpeakerDevice = useCallback((deviceId: string) => {
    setSpeakerDeviceId(deviceId);
  }, []);

  useEffect(() => {
    if (!options.autoStart) return;
    if (options.initialMicOn) void startMic(options.initialMicDeviceId);
    if (options.initialCameraOn) void startCamera(options.initialCameraDeviceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopPreview = useCallback(() => {
    releasedRef.current = true;
    stopMic();
    stopCamera();
  }, [stopCamera, stopMic]);

  const releaseTracks = useCallback(() => {
    micTokenRef.current += 1;
    cameraTokenRef.current += 1;
    micTrackRef.current = null;
    cameraTrackRef.current = null;
    setMicTrack(null);
    setCameraTrack(null);
  }, []);

  useEffect(() => {
    return () => {
      releasedRef.current = true;
      micTrackRef.current?.stop();
      cameraTrackRef.current?.stop();
    };
  }, []);

  const openSystemSettings = useCallback((kind: DeviceKind) => {
    const url = MACOS_PRIVACY_URLS[kind === 'mic' ? 'microphone' : 'camera'];
    if (isElectronApp() && url) {
      window.electronAPI?.openExternal?.(url);
    }
  }, []);

  return {
    micOn,
    cameraOn,
    micTrack,
    cameraTrack,
    micPermission,
    cameraPermission,
    micDevices: devices.filter(d => d.kind === 'audioinput'),
    cameraDevices: devices.filter(d => d.kind === 'videoinput'),
    speakerDevices: devices.filter(d => d.kind === 'audiooutput'),
    micDeviceId,
    cameraDeviceId,
    speakerDeviceId,
    setMicOn,
    setCameraOn,
    selectMicDevice,
    selectCameraDevice,
    selectSpeakerDevice,
    stopPreview,
    releaseTracks,
    openSystemSettings,
  };
}
