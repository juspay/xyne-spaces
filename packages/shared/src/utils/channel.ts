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

export const CHANNEL_NAME_MIN_LENGTH = 2;
export const CHANNEL_NAME_MAX_LENGTH = 80;

export function normalizeChannelName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '');
}

export function validateChannelName(value: string): string | null {
  if (value.length < CHANNEL_NAME_MIN_LENGTH)
    return `Channel name must be at least ${CHANNEL_NAME_MIN_LENGTH} characters`;
  if (value.length > CHANNEL_NAME_MAX_LENGTH)
    return `Channel name must be ${CHANNEL_NAME_MAX_LENGTH} characters or less`;
  if (!/^[a-z0-9-_]+$/.test(value))
    return 'Only lowercase letters, numbers, hyphens, and underscores are allowed';
  return null;
}
