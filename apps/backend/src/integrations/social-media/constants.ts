import { ExternalSourcePlatform } from '@/integrations/core/types';

export const SOCIAL_MEDIA_INTERACTION_TYPES = {
  REVIEW: 'REVIEW',
  DM: 'DM',
  REPLY: 'REPLY',
  MENTION: 'MENTION',
} as const;

/** Every review-desk provider. Routes scoped to a SOCIAL_MEDIA desk must filter on this, not one platform. */
export const SOCIAL_MEDIA_PLATFORMS: readonly ExternalSourcePlatform[] = [
  ExternalSourcePlatform.GOOGLE_PLAY,
  ExternalSourcePlatform.APP_STORE,
  ExternalSourcePlatform.INSTAGRAM,
  ExternalSourcePlatform.FACEBOOK,
] as const;

/** Meta messaging providers: webhook-driven, 24h reply window, several accounts per desk. */
export const META_MESSAGING_PLATFORMS: readonly ExternalSourcePlatform[] = [
  ExternalSourcePlatform.INSTAGRAM,
  ExternalSourcePlatform.FACEBOOK,
] as const;

export function isMetaMessagingPlatform(sourceType: string): boolean {
  return META_MESSAGING_PLATFORMS.includes(sourceType as ExternalSourcePlatform);
}

export function isSocialMediaPlatform(sourceType: string): boolean {
  return SOCIAL_MEDIA_PLATFORMS.includes(sourceType as ExternalSourcePlatform);
}
