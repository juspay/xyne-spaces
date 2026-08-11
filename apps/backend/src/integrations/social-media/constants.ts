export const SOCIAL_MEDIA_SOURCE_TYPES = {
  INSTAGRAM: 'instagram',
} as const;

export type SocialMediaSourceType =
  (typeof SOCIAL_MEDIA_SOURCE_TYPES)[keyof typeof SOCIAL_MEDIA_SOURCE_TYPES];

export const SOCIAL_MEDIA_INTERACTION_TYPES = {
  DM: 'DM',
  REPLY: 'REPLY',
  COMMENT: 'COMMENT',
  MENTION: 'MENTION',
} as const;
