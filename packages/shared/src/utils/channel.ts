import { ChannelRole, ChannelScopeType, ChannelType, DeskType, MAX_CHANNEL_PUBLISHED_APPS, MAX_DESK_APPS } from '../zero/types.js';

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
 * An ordered list of artifact app ids kept in one TEXT column (a JSON string[]
 * so Zero can sync it). Anything malformed reads as no apps rather than
 * throwing, since a bad value must not break the screen showing them.
 */
export function parseAppIdList(raw: string | null | undefined, max: number): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const ids = parsed.filter((id): id is string => typeof id === 'string' && id.length > 0);
    return [...new Set(ids)].slice(0, max);
  } catch {
    return [];
  }
}

/** Write-side twin of parseAppIdList: de-duplicated, order kept, empty → null. */
export function serializeAppIdList(ids: readonly string[] | null): string | null {
  const unique = [...new Set(ids ?? [])];
  return unique.length > 0 ? JSON.stringify(unique) : null;
}

/** The artifact apps on a desk (EmailChannelPreference.deskAppIds), in order. */
export function parseDeskAppIds(raw: string | null | undefined): string[] {
  return parseAppIdList(raw, MAX_DESK_APPS);
}

export const serializeDeskAppIds = serializeAppIdList;

/**
 * Apps a channel admin published to a normal channel (Channel.publishedAppIds),
 * in order. Desks never have any — see isDeskChannelType.
 */
export function parsePublishedAppIds(raw: string | null | undefined): string[] {
  return parseAppIdList(raw, MAX_CHANNEL_PUBLISHED_APPS);
}

/**
 * Whether a channel has member-customizable tabs and can have apps published to
 * it: public and private channels, DMs and group DMs — never a desk (desks are
 * DEFAULT-scoped too, and keep their own email_channel_preferences.deskAppIds)
 * and never a ticket or document channel.
 */
export function supportsChannelApps(channel: {
  scopeType?: string | null;
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
 * Who may publish apps (Channel.publishedAppIds), given the caller's participant
 * role (null when they are not a participant). In a channel, only its ADMINs; in
 * a DM or group DM every participant is a peer, so any of them may. The same
 * rule runs in both mutators, the channels ACL and the UI.
 */
export function canPublishChannelApps(
  scopeType: string | null | undefined,
  participantRole: string | null | undefined,
): boolean {
  if (!participantRole) return false;
  if (scopeType === ChannelScopeType.DM || scopeType === ChannelScopeType.GROUP_DM) return true;
  return scopeType === ChannelScopeType.DEFAULT && participantRole === ChannelRole.ADMIN;
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
