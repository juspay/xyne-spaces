import { config } from '@/config/env';

export type ElevenLabsVoice = { id: string; name: string; description: string };

// Voices of the India-residency ElevenLabs workspace that users may pick from.
const VOICES: ElevenLabsVoice[] = [
  { id: 'gHu9GtaHOXcSqFTK06ux', name: 'Anjali', description: 'Indian female, Hindi and English' },
  { id: 'rxvktZTNrsQlsGIpOQGz', name: 'Aasha', description: 'Indian female, warm' },
  { id: 'fPIfC3elMLbN9tNwMXkw', name: 'Viraj', description: 'Indian male' },
  { id: 'OYTbf65OHHFELVut7v2H', name: 'Hope', description: 'American female' },
];

export const isElevenLabsVoiceId = (voice: string): boolean => VOICES.some((v) => v.id === voice);

// The configured voice when it is one of the listed ones, else the first listed voice.
export const defaultVoiceId = (): string =>
  isElevenLabsVoiceId(config.elevenLabs.ttsVoiceId) ? config.elevenLabs.ttsVoiceId : VOICES[0]!.id;

export const getElevenLabsVoices = (): { voices: ElevenLabsVoice[]; defaultVoiceId: string } => ({
  voices: VOICES,
  defaultVoiceId: defaultVoiceId(),
});
