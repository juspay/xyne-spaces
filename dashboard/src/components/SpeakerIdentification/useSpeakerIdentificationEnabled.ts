import { useCacConfig } from '../../hooks/useCacConfig';
import {
  SPEAKER_IDENTIFICATION_CAC_KEY,
  DEFAULT_SPEAKER_IDENTIFICATION_CAC_CONFIG,
  type SpeakerIdentificationCacConfig,
} from './speakerIdentificationCacConfig';

/**
 * Returns whether the speaker identification feature is enabled via CAC.
 * Use this wherever the identified transcript should be shown or used.
 */
export function useSpeakerIdentificationEnabled(): boolean {
  const { config } = useCacConfig<SpeakerIdentificationCacConfig>({
    key: SPEAKER_IDENTIFICATION_CAC_KEY,
    fallbackConfig: DEFAULT_SPEAKER_IDENTIFICATION_CAC_CONFIG,
  });

  return config.enabled;
}
