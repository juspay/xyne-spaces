export interface InitialCallMediaSettings {
  microphoneEnabled: boolean;
  cameraEnabled: boolean;
}

export function resolveInitialCallMediaSettings(
  callType: string,
  requested?: Partial<InitialCallMediaSettings>,
): InitialCallMediaSettings {
  return {
    microphoneEnabled: requested?.microphoneEnabled ?? true,
    cameraEnabled: requested?.cameraEnabled ?? callType === 'VIDEO',
  };
}

export function readSingleRouteParam(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  return value?.[0];
}

export function parseOptionalBooleanRouteParam(
  value: string | string[] | undefined,
): boolean | undefined {
  const normalized = readSingleRouteParam(value)?.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return undefined;
}
