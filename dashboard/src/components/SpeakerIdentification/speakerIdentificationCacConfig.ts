/**
 * CAC key: "speaker_identification_config"
 *
 * Master feature flag for real-time speaker identification.
 * When disabled:
 *   - Frontend shows plain transcript instead of identified transcript in
 *     CallBubble and RecordingDetailScreen.
 *   - Backend skips the identified transcript for summary/title generation
 *     even for HEADLESS calls.
 *
 * Toggle from Superposition CAC:
 *   key:   speaker_identification_config
 *   value: { "enabled": true }  ← use identified transcript everywhere
 *   value: { "enabled": false } ← fall back to plain transcript everywhere
 */

export const SPEAKER_IDENTIFICATION_CAC_KEY = 'speaker_identification_config';

export interface SpeakerIdentificationCacConfig {
  enabled: boolean;
}

export const DEFAULT_SPEAKER_IDENTIFICATION_CAC_CONFIG: SpeakerIdentificationCacConfig = {
  enabled: false, // default: off
};
