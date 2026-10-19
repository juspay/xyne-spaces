import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

export type MediaKind = 'audio' | 'video';

/** Why a device is unusable, if it is. */
export type DeviceIssue = 'blocked' | 'missing' | 'in_use' | null;

export interface MediaPreview {
  /** What the user wants — kept across the call so a rejoin keeps their choice. */
  micOn: boolean;
  camOn: boolean;
  audioTrack: MediaStreamTrack | null;
  videoTrack: MediaStreamTrack | null;
  isCameraStarting: boolean;
  micIssue: DeviceIssue;
  camIssue: DeviceIssue;
  audioInputs: MediaDeviceInfo[];
  videoInputs: MediaDeviceInfo[];
  /** The device in use (or picked), for the selectors. */
  audioDeviceId: string | null;
  videoDeviceId: string | null;
  /** Only devices the user explicitly picked — what the call should use. */
  pickedAudioDeviceId: string | null;
  pickedVideoDeviceId: string | null;
  toggleMic: () => void;
  toggleCam: () => void;
  selectAudioDevice: (deviceId: string) => void;
  selectVideoDevice: (deviceId: string) => void;
}

const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  facingMode: 'user',
};

function classify(err: unknown): DeviceIssue {
  const name = (err as DOMException | undefined)?.name;
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return 'blocked';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return 'missing';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return 'in_use';
  }
  return 'missing';
}

const DEVICE_LABEL: Record<MediaKind, string> = { audio: 'Microphone', video: 'Camera' };

function notifyIssue(kind: MediaKind, issue: DeviceIssue): void {
  const device = DEVICE_LABEL[kind];
  if (issue === 'blocked') {
    toast.error(`${device} access is blocked`, {
      id: `lobby-${kind}-blocked`,
      description: 'Allow access from the icon in your browser’s address bar, then try again.',
      duration: 6000,
    });
  } else if (issue === 'in_use') {
    toast.error(`${device} is in use`, {
      id: `lobby-${kind}-in-use`,
      description: 'Close other apps that may be using it, then try again.',
      duration: 6000,
    });
  } else if (issue === 'missing') {
    toast.error(`No ${device.toLowerCase()} found`, { id: `lobby-${kind}-missing`, duration: 5000 });
  }
}

/**
 * Local camera + mic preview for the pre-join screen.
 *
 * Tracks are only held while `active`: they are released before the call
 * connects (LiveKit opens its own) and re-opened when the user is back in the
 * lobby. The on/off choice outlives that, so it can be carried into the call.
 */
export function useMediaPreview(active: boolean): MediaPreview {
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [audioTrack, setAudioTrack] = useState<MediaStreamTrack | null>(null);
  const [videoTrack, setVideoTrack] = useState<MediaStreamTrack | null>(null);
  const [isCameraStarting, setIsCameraStarting] = useState(false);
  const [micIssue, setMicIssue] = useState<DeviceIssue>(null);
  const [camIssue, setCamIssue] = useState<DeviceIssue>(null);
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [videoInputs, setVideoInputs] = useState<MediaDeviceInfo[]>([]);
  const [pickedAudioDeviceId, setPickedAudioDeviceId] = useState<string | null>(null);
  const [pickedVideoDeviceId, setPickedVideoDeviceId] = useState<string | null>(null);

  const tracksRef = useRef<Record<MediaKind, MediaStreamTrack | null>>({ audio: null, video: null });
  // Bumped on every acquire/release so a slow getUserMedia can't resurrect a
  // track the user has since turned off (or that StrictMode tore down).
  const generationRef = useRef<Record<MediaKind, number>>({ audio: 0, video: 0 });
  const pickedRef = useRef<Record<MediaKind, string | null>>({ audio: null, video: null });
  const activeRef = useRef(active);
  activeRef.current = active;

  const setTrack = useCallback((kind: MediaKind, track: MediaStreamTrack | null) => {
    if (kind === 'audio') setAudioTrack(track);
    else setVideoTrack(track);
  }, []);

  const setOn = useCallback((kind: MediaKind, on: boolean) => {
    if (kind === 'audio') setMicOn(on);
    else setCamOn(on);
  }, []);

  const setIssue = useCallback((kind: MediaKind, issue: DeviceIssue) => {
    if (kind === 'audio') setMicIssue(issue);
    else setCamIssue(issue);
  }, []);

  const release = useCallback(
    (kind: MediaKind) => {
      generationRef.current[kind] += 1;
      tracksRef.current[kind]?.stop();
      tracksRef.current[kind] = null;
      setTrack(kind, null);
      if (kind === 'video') setIsCameraStarting(false);
    },
    [setTrack],
  );

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      // Before permission is granted labels/ids are blank; those entries are useless.
      const usable = devices.filter(d => d.deviceId && d.label);
      setAudioInputs(usable.filter(d => d.kind === 'audioinput'));
      setVideoInputs(usable.filter(d => d.kind === 'videoinput'));
    } catch {
      // Listing devices is best-effort; the selectors just stay empty.
    }
  }, []);

  const acquire = useCallback(
    async (kinds: MediaKind[]): Promise<void> => {
      if (kinds.length === 0) return;
      if (!navigator.mediaDevices?.getUserMedia) {
        kinds.forEach(kind => {
          setOn(kind, false);
          setIssue(kind, 'missing');
        });
        return;
      }

      const generations = {} as Record<MediaKind, number>;
      kinds.forEach(kind => {
        release(kind);
        generations[kind] = generationRef.current[kind];
      });
      const isCurrent = (kind: MediaKind): boolean =>
        activeRef.current && generations[kind] === generationRef.current[kind];

      if (kinds.includes('video')) setIsCameraStarting(true);

      const audioId = pickedRef.current.audio;
      const videoId = pickedRef.current.video;
      const constraints: MediaStreamConstraints = {
        audio: kinds.includes('audio')
          ? audioId
            ? { deviceId: { exact: audioId } }
            : true
          : false,
        video: kinds.includes('video')
          ? videoId
            ? { ...VIDEO_CONSTRAINTS, deviceId: { exact: videoId } }
            : VIDEO_CONSTRAINTS
          : false,
      };

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        const issue = classify(err);
        if (kinds.length > 1) {
          // One device missing, busy or blocked must not take the other down with it.
          await Promise.all(kinds.map(kind => (isCurrent(kind) ? acquire([kind]) : Promise.resolve())));
          return;
        }
        // A picked device that has been unplugged: fall back to the default.
        const pickedGone = kinds.length === 1 && issue === 'missing' && pickedRef.current[kinds[0]!];
        if (pickedGone && isCurrent(kinds[0]!)) {
          const kind = kinds[0]!;
          pickedRef.current[kind] = null;
          if (kind === 'audio') setPickedAudioDeviceId(null);
          else setPickedVideoDeviceId(null);
          await acquire([kind]);
          return;
        }
        kinds.forEach(kind => {
          if (!isCurrent(kind)) return;
          setOn(kind, false);
          setIssue(kind, issue);
          if (kind === 'video') setIsCameraStarting(false);
          notifyIssue(kind, issue);
        });
        return;
      }

      stream.getTracks().forEach(track => {
        const kind = track.kind as MediaKind;
        if (!isCurrent(kind)) {
          track.stop();
          return;
        }
        tracksRef.current[kind] = track;
        setTrack(kind, track);
        setIssue(kind, null);
        if (kind === 'video') setIsCameraStarting(false);
        // Unplugged or revoked mid-preview.
        track.addEventListener('ended', () => {
          if (tracksRef.current[kind] !== track) return;
          release(kind);
          setOn(kind, false);
        });
      });
      void refreshDevices();
    },
    [refreshDevices, release, setIssue, setOn, setTrack],
  );

  // Open the devices the user wants whenever the preview becomes visible, and
  // let go of them as soon as it isn't (so the call can take them).
  const wantedRef = useRef({ micOn, camOn });
  wantedRef.current = { micOn, camOn };
  useEffect(() => {
    if (!active) return undefined;
    const kinds: MediaKind[] = [];
    if (wantedRef.current.micOn) kinds.push('audio');
    if (wantedRef.current.camOn) kinds.push('video');
    void acquire(kinds);
    void refreshDevices();
    return () => {
      release('audio');
      release('video');
    };
  }, [active, acquire, refreshDevices, release]);

  useEffect(() => {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.addEventListener) return undefined;
    const onChange = (): void => void refreshDevices();
    mediaDevices.addEventListener('devicechange', onChange);
    return () => mediaDevices.removeEventListener('devicechange', onChange);
  }, [refreshDevices]);

  const toggle = useCallback(
    (kind: MediaKind, isOn: boolean) => {
      if (isOn) {
        release(kind);
        setOn(kind, false);
        return;
      }
      setOn(kind, true);
      setIssue(kind, null);
      if (activeRef.current) void acquire([kind]);
    },
    [acquire, release, setIssue, setOn],
  );

  const toggleMic = useCallback(() => toggle('audio', micOn), [toggle, micOn]);
  const toggleCam = useCallback(() => toggle('video', camOn), [toggle, camOn]);

  const selectDevice = useCallback(
    (kind: MediaKind, deviceId: string, isOn: boolean) => {
      pickedRef.current[kind] = deviceId;
      if (kind === 'audio') setPickedAudioDeviceId(deviceId);
      else setPickedVideoDeviceId(deviceId);
      if (isOn && activeRef.current) void acquire([kind]);
    },
    [acquire],
  );

  const selectAudioDevice = useCallback(
    (deviceId: string) => selectDevice('audio', deviceId, micOn),
    [selectDevice, micOn],
  );
  const selectVideoDevice = useCallback(
    (deviceId: string) => selectDevice('video', deviceId, camOn),
    [selectDevice, camOn],
  );

  return {
    micOn,
    camOn,
    audioTrack,
    videoTrack,
    isCameraStarting,
    micIssue,
    camIssue,
    audioInputs,
    videoInputs,
    audioDeviceId: pickedAudioDeviceId ?? audioTrack?.getSettings().deviceId ?? null,
    videoDeviceId: pickedVideoDeviceId ?? videoTrack?.getSettings().deviceId ?? null,
    pickedAudioDeviceId,
    pickedVideoDeviceId,
    toggleMic,
    toggleCam,
    selectAudioDevice,
    selectVideoDevice,
  };
}
