import { ChannelType, DeskType } from '../zero/schema.js';

/** Desk channel types — EMAIL, SLACK and APP channels all feed into Xyne Desk. */
export const DESK_CHANNEL_TYPES: ReadonlySet<ChannelType> = new Set([
  ChannelType.EMAIL,
  ChannelType.SLACK,
  ChannelType.APP,
  ChannelType.CALL,
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
    default:
      return DeskType.EMAIL;
  }
}
