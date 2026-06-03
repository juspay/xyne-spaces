import { ChannelType } from '../zero/schema.js';

/** Desk channel types — EMAIL and SLACK channels both feed into Xyne Desk. */
export const DESK_CHANNEL_TYPES: ReadonlySet<ChannelType> = new Set([
  ChannelType.EMAIL,
  ChannelType.SLACK,
]);

export function isDeskChannelType(type: string | null | undefined): boolean {
  return DESK_CHANNEL_TYPES.has(type as ChannelType);
}
