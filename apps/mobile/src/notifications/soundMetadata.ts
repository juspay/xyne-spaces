export type NotificationSoundId = 'default' | 'bell' | 'string';

export interface NotificationSoundOption {
  readonly id: NotificationSoundId;
  readonly label: string;
  readonly description?: string;
}

export const NOTIFICATION_SOUND_OPTIONS = [
  {
    id: 'default',
    label: 'Default',
    description: 'Use your device’s notification sound',
  },
  { id: 'bell', label: 'Bell' },
  { id: 'string', label: 'String' },
] as const satisfies readonly NotificationSoundOption[];

export const DEFAULT_SOUND_ID: NotificationSoundId = 'string';

export function isKnownSoundId(value: unknown): value is NotificationSoundId {
  return (
    typeof value === 'string' && NOTIFICATION_SOUND_OPTIONS.some(option => option.id === value)
  );
}

/** iOS: notifee `ios.sound` value. */
export function iosSoundFor(id: NotificationSoundId): string {
  if (id === 'default') return 'default';
  return `${id}.caf`;
}

/** Returns the stable Android notification channel for a sound choice. */
export function androidChannelIdFor(id: NotificationSoundId, baseChannelId: string): string {
  if (id === 'default') return baseChannelId;
  return `${baseChannelId}__${id}`;
}
