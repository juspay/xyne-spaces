import { ChannelType, DeskType } from '../zero/schema.js';

/** Channel types that feed into Xyne Desk. */
export const DESK_CHANNEL_TYPES: ReadonlySet<ChannelType> = new Set([
  ChannelType.EMAIL,
  ChannelType.SLACK,
  ChannelType.APP,
  ChannelType.CALL,
  ChannelType.SOCIAL_MEDIA,
]);

export function isDeskChannelType(type: string | null | undefined): boolean {
  return DESK_CHANNEL_TYPES.has(type as ChannelType);
}

/** APP and LOG desks both ingest via the same app-desk webhook/query paths. */
export const APP_LIKE_DESK_TYPES: ReadonlySet<DeskType> = new Set([DeskType.APP, DeskType.LOG]);

export function isAppLikeDeskType(type: DeskType | string | null | undefined): boolean {
  return APP_LIKE_DESK_TYPES.has(type as DeskType);
}

/** Desk type label for a channel — SLACK and APP desks store their settings in email_channel_preferences too. */
export function deskTypeForChannelType(type: string | null | undefined): DeskType {
  switch (type) {
    case ChannelType.SLACK:
      return DeskType.SLACK;
    case ChannelType.APP:
      return DeskType.APP;
    case ChannelType.CALL:
      return DeskType.CALL;
    case ChannelType.SOCIAL_MEDIA:
      return DeskType.SOCIAL_MEDIA;
    default:
      return DeskType.EMAIL;
  }
}
