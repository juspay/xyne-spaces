import { ExternalSourcePlatform } from '@/integrations/core/types';

export const SOCIAL_MEDIA_INTERACTION_TYPES = {
  REVIEW: 'REVIEW',
  REPLY: 'REPLY',
} as const;

/** Every review-desk provider. Routes scoped to a SOCIAL_MEDIA desk must filter on this, not one platform. */
export const SOCIAL_MEDIA_PLATFORMS: readonly ExternalSourcePlatform[] = [
  ExternalSourcePlatform.GOOGLE_PLAY,
  ExternalSourcePlatform.APP_STORE,
] as const;

export function isSocialMediaPlatform(sourceType: string): boolean {
  return SOCIAL_MEDIA_PLATFORMS.includes(sourceType as ExternalSourcePlatform);
}
