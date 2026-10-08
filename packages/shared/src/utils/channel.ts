import { ChannelRole, ChannelScopeType, ChannelType, DeskType } from '../zero/types.js';

/** Desk channel types — EMAIL, SLACK, APP, CALL and SOCIAL_MEDIA channels all feed into Xyne Desk. */
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

/**
 * Whether a channel has member-customizable tabs: public and private channels,
 * DMs and group DMs — never a desk (desks are DEFAULT-scoped too, but show their
 * published apps in the desk's Apps menu instead) and never a ticket or document
 * channel.
 */
export function supportsChannelApps(channel: {
  scopeType?: ChannelScopeType | null;
  type?: string | null;
}): boolean {
  const scope = channel.scopeType;
  const isConversation =
    scope === ChannelScopeType.DEFAULT ||
    scope === ChannelScopeType.DM ||
    scope === ChannelScopeType.GROUP_DM;
  return isConversation && !isDeskChannelType(channel.type);
}

/**
 * Who may publish apps to a channel, DM or group DM (not a desk — see
 * canPublishAppsTo), given the caller's participant role (null when they are not
 * a participant). In a channel, only its ADMINs; in a DM or group DM every
 * participant is a peer, so any of them may.
 */
export function canPublishChannelApps(
  scopeType: ChannelScopeType | null | undefined,
  participantRole: ChannelRole | null | undefined,
): boolean {
  if (!participantRole) return false;
  if (scopeType === ChannelScopeType.DM || scopeType === ChannelScopeType.GROUP_DM) return true;
  return scopeType === ChannelScopeType.DEFAULT && participantRole === ChannelRole.ADMIN;
}

/** Longest app id accepted in channel_published_apps.appId (ids are 25-char cuids). */
export const MAX_PUBLISHED_APP_ID_LENGTH = 64;

/**
 * Who may publish or unpublish an app (channel_published_apps) — the single rule
 * the mutators, the table's ACL and the dashboard all use:
 *  - desk: its owner (email_channel_preferences.ownerUserId) or a channel ADMIN;
 *  - channel: ADMINs only; DM / group DM: any participant;
 *  - anything else (ticket, document): nobody.
 */
export function canPublishAppsTo(
  channel: { scopeType?: ChannelScopeType | null; type?: string | null },
  participantRole: ChannelRole | null | undefined,
  isDeskOwner: boolean,
): boolean {
  if (isDeskChannelType(channel.type)) {
    return isDeskOwner || participantRole === ChannelRole.ADMIN;
  }
  return supportsChannelApps(channel) && canPublishChannelApps(channel.scopeType, participantRole);
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
