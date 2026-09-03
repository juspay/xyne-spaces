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
  { value: '720p', label: '720p', description: 'HD' },
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

const DETECTED_MAX_CAMERA_HEIGHT_KEY = 'xyne:detected-camera-max-height';

const readStoredMaxCameraHeight = (): number | null => {
  if (typeof sessionStorage === 'undefined') return null;
  const parsed = Number(sessionStorage.getItem(DETECTED_MAX_CAMERA_HEIGHT_KEY));
  return parsed > 0 ? parsed : null;
};

let detectedMaxCameraHeight: number | null = readStoredMaxCameraHeight();

export const setDetectedMaxCameraHeight = (height: number | null): void => {
  detectedMaxCameraHeight = height;
  if (height && typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem(DETECTED_MAX_CAMERA_HEIGHT_KEY, String(height));
  }
};
export const getDetectedMaxCameraHeight = (): number | null => detectedMaxCameraHeight;

const getHighestCameraQuality = (): CallMediaQuality => {
  if (!detectedMaxCameraHeight) return '1080p';
  const supported = CALL_MEDIA_QUALITY_OPTIONS.filter(
    option => CALL_MEDIA_QUALITY_CONFIG[option.value].height <= detectedMaxCameraHeight!,
  );
  return supported.at(-1)?.value ?? '1080p';
};

const DEFAULT_SETTINGS: CallMediaQualitySettings = {
  get videoQuality() {
    return getHighestCameraQuality();
  },
  screenShareQuality: '2160p',
};

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
