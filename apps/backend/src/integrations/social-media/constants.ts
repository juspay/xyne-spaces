export const SOCIAL_MEDIA_SOURCE_TYPES = {
  INSTAGRAM: 'instagram',
  GOOGLE_PLAY: 'google-play-reviews',
} as const;

export type SocialMediaSourceType =
  (typeof SOCIAL_MEDIA_SOURCE_TYPES)[keyof typeof SOCIAL_MEDIA_SOURCE_TYPES];


export const SOCIAL_MEDIA_INTERACTION_TYPES = {
  REVIEW: 'REVIEW',
  DM: 'DM',
  REPLY: 'REPLY',
} as const;

