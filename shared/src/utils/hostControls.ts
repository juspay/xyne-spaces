import { DEFAULT_HOST_CONTROLS, type HostControls } from '../types/call';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeBoolean(
  controls: Record<string, unknown>,
  key: keyof HostControls,
  legacyKey: string,
  fallback: boolean,
): boolean {
  const value = controls[key];
  if (typeof value === 'boolean') return value;

  const legacyValue = controls[legacyKey];
  return typeof legacyValue === 'boolean' ? legacyValue : fallback;
}

export function normalizeHostControls(
  value: unknown,
  fallback: HostControls = DEFAULT_HOST_CONTROLS,
): HostControls | null {
  if (!isRecord(value)) return null;

  return {
    turnOffAudio: normalizeBoolean(value, 'turnOffAudio', 'lockMic', fallback.turnOffAudio),
    turnOffCamera: normalizeBoolean(value, 'turnOffCamera', 'lockCamera', fallback.turnOffCamera),
    turnOffScreenShare: normalizeBoolean(
      value,
      'turnOffScreenShare',
      'lockScreenShare',
      fallback.turnOffScreenShare,
    ),
  };
}
