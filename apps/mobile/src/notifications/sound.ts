import bellSound from '../../assets/sounds/bell.mp3';
import stringSound from '../../assets/sounds/string.mp3';

import { NOTIFICATION_SOUND_OPTIONS, type NotificationSoundOption } from './soundMetadata';

export type { NotificationSoundId } from './soundMetadata';

export interface SoundOption extends NotificationSoundOption {
  /** require()'d mp3 used by the in-app preview player (null for device default). */
  readonly previewAsset: number | null;
}

export const NOTIFICATION_SOUNDS: readonly SoundOption[] = [
  {
    ...NOTIFICATION_SOUND_OPTIONS[0],
    previewAsset: null,
  },
  {
    ...NOTIFICATION_SOUND_OPTIONS[1],
    previewAsset: bellSound,
  },
  {
    ...NOTIFICATION_SOUND_OPTIONS[2],
    previewAsset: stringSound,
  },
] as const;
