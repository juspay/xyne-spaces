export const ANDROID_PACKAGE_NAME_PATTERN =
  /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;

/** Apple bundle ids allow hyphens, so the Android pattern cannot be reused. */
export const IOS_BUNDLE_ID_PATTERN = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

/** App Store Connect key ids. Team key ids are 10 chars, individual key ids are longer. */
export const APP_STORE_KEY_ID_PATTERN = /^[A-Z0-9]{10,20}$/;

export const SOCIAL_MEDIA_SOURCE_TYPE = {
  GOOGLE_PLAY: 'google-play-reviews',
  APP_STORE: 'app-store-reviews',
  INSTAGRAM: 'instagram',
} as const;
