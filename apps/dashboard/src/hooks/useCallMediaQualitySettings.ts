import { useSyncExternalStore } from 'react';

export const CALL_MEDIA_QUALITY_SETTINGS_KEY = 'xyne:call-media-quality-settings';

export type CallMediaQuality = '720p' | '1080p' | '1440p' | '2160p';

export interface CallMediaQualitySettings {
  videoQuality: CallMediaQuality;
  screenShareQuality: CallMediaQuality;
}

export const CALL_MEDIA_QUALITY_OPTIONS: Array<{
  value: CallMediaQuality;
  label: string;
  description: string;
}> = [
  { value: '720p', label: '720p', description: 'Lower bandwidth' },
  { value: '1080p', label: '1080p', description: 'Full HD' },
  { value: '1440p', label: '1440p', description: '2K' },
  { value: '2160p', label: '2160p', description: '4K' },
];

export const CALL_MEDIA_QUALITY_CONFIG: Record<
  CallMediaQuality,
  { width: number; height: number; frameRate: number; maxBitrate: number }
> = {
  '720p': { width: 1280, height: 720, frameRate: 30, maxBitrate: 2_500_000 },
  '1080p': { width: 1920, height: 1080, frameRate: 30, maxBitrate: 5_000_000 },
  '1440p': { width: 2560, height: 1440, frameRate: 30, maxBitrate: 8_000_000 },
  '2160p': { width: 3840, height: 2160, frameRate: 30, maxBitrate: 10_000_000 },
};

const DEFAULT_SETTINGS: CallMediaQualitySettings = {
  videoQuality: '2160p',
  screenShareQuality: '2160p',
};

/**
 * Test knob for the publish codec. Flip this to try codecs end-to-end.
 *   'vp8'  - LiveKit default, most compatible, simulcast (no SVC)
 *   'vp9'  - better compression, uses SVC + VP8 backup
 *   'av1'  - best compression, highest encoder CPU, uses SVC + VP8 backup
 *   'h264' - hardware-friendly, no SVC
 */
export type CallVideoCodec = 'vp8' | 'vp9' | 'av1' | 'h264';

export const CALL_VIDEO_CODEC: CallVideoCodec = 'av1';

// VP9/AV1 support scalable video coding (SVC) — a single graceful-degradation
// stream. VP8/H.264 use simulcast instead and take no scalabilityMode/backupCodec.
const SVC_CODECS: readonly CallVideoCodec[] = ['vp9', 'av1'];

export const isSvcCodec = (codec: CallVideoCodec): boolean => SVC_CODECS.includes(codec);

const listeners = new Set<() => void>();

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = (): string => localStorage.getItem(CALL_MEDIA_QUALITY_SETTINGS_KEY) ?? '';
const getServerSnapshot = (): string => '';

const isQuality = (value: unknown): value is CallMediaQuality =>
  typeof value === 'string' && value in CALL_MEDIA_QUALITY_CONFIG;

const parseSettings = (raw: string): CallMediaQualitySettings => {
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<CallMediaQualitySettings>;
    return {
      videoQuality: isQuality(parsed.videoQuality)
        ? parsed.videoQuality
        : DEFAULT_SETTINGS.videoQuality,
      screenShareQuality: isQuality(parsed.screenShareQuality)
        ? parsed.screenShareQuality
        : DEFAULT_SETTINGS.screenShareQuality,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
};

export const getCallMediaQualitySettings = (): CallMediaQualitySettings => {
  if (typeof localStorage === 'undefined') return DEFAULT_SETTINGS;
  return parseSettings(localStorage.getItem(CALL_MEDIA_QUALITY_SETTINGS_KEY) ?? '');
};

const saveSettings = (settings: CallMediaQualitySettings): void => {
  localStorage.setItem(CALL_MEDIA_QUALITY_SETTINGS_KEY, JSON.stringify(settings));
  listeners.forEach(listener => listener());
};

export const useCallMediaQualitySettings = (): CallMediaQualitySettings & {
  setVideoQuality: (value: CallMediaQuality) => void;
  setScreenShareQuality: (value: CallMediaQuality) => void;
} => {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const settings = parseSettings(raw);

  const setVideoQuality = (value: CallMediaQuality): void => {
    saveSettings({ ...settings, videoQuality: value });
  };

  const setScreenShareQuality = (value: CallMediaQuality): void => {
    saveSettings({ ...settings, screenShareQuality: value });
  };

  return {
    ...settings,
    setVideoQuality,
    setScreenShareQuality,
  };
};
